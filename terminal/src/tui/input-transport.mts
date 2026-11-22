'use strict';

import { PassThrough, Transform, type TransformCallback } from 'node:stream';
import type { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export type DashboardSection = 'inventory' | 'browse' | 'catalogs';
export type DashboardFilter = 'catalog' | 'kind' | 'license';
export type DashboardControlFocus = 'tabs' | 'search' | DashboardFilter | 'actions' | 'list';

type ScrollDirection = -1 | 1;

export type DashboardMouseTarget =
  | { type: 'section'; section: DashboardSection }
  | { type: 'focus'; focus: DashboardControlFocus }
  | { type: 'filter-open'; filter: DashboardFilter }
  | { type: 'filter-option'; filter: DashboardFilter; value: string }
  | { type: 'filter-dismiss'; filter: DashboardFilter }
  | { type: 'modal-choice'; index: number }
  | { type: 'modal-option'; group: 'scope' | 'client'; index: number }
  | { type: 'row'; screen: DashboardSection; index: number }
  | { type: 'action'; action: string };

interface MouseBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface DashboardMouseRegion extends MouseBounds {
  target: DashboardMouseTarget;
}

export interface DashboardScrollRegion extends MouseBounds {
  move: (direction: ScrollDirection) => void;
}

export interface DashboardMouseReport {
  x: number;
  y: number;
  button: 0 | 64 | 65;
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean };
}
export class DashboardMouseRegions {
  private readonly owners = new Map<string, DashboardMouseRegion[]>();
  private scrollRegions: DashboardScrollRegion[] = [];
  private handler?: (target: DashboardMouseTarget) => void;

  private clickPending = false;

  replace(owner: string, regions: DashboardMouseRegion[]) {
    if (regions.length) this.owners.set(owner, regions);
    else this.owners.delete(owner);
  }

  setScrollRegions(regions: DashboardScrollRegion[]) {
    this.scrollRegions = regions;
  }

  setHandler(handler: (target: DashboardMouseTarget) => void) {
    this.handler = handler;
  }

  getRegions() {
    return [...this.owners.values()].flat();
  }

  private dispatchClick(target: DashboardMouseTarget) {
    if (target.type !== 'row') {
      // One action per input burst, even if React has not committed the next screen yet.
      this.clickPending = true;
      queueMicrotask(() => {
        this.clickPending = false;
      });
    }
    this.handler?.(target);
  }

  dispatch({ x, y, button, modifiers }: DashboardMouseReport) {
    // Modified reports are reserved for terminal shortcuts such as text selection.
    if (modifiers.shift || modifiers.alt || modifiers.ctrl) return;
    const contains = ({ left, right, top, bottom }: MouseBounds) => x >= left && x <= right && y >= top && y <= bottom;
    if (button === 64 || button === 65) {
      this.scrollRegions.find(contains)?.move(button === 64 ? -1 : 1);
      return;
    }
    if (this.clickPending) return;
    const modal = this.owners.get('modal')?.find(contains);
    if (modal) {
      this.dispatchClick(modal.target);
      return;
    }
    for (const regions of this.owners.values()) {
      for (const region of regions) {
        if (
          (region.target.type === 'filter-option' || region.target.type === 'filter-dismiss') &&
          contains(region)
        ) {
          this.dispatchClick(region.target);
          return;
        }
      }
    }
    for (const regions of this.owners.values()) {
      const region = regions.find(contains);
      if (region) {
        this.dispatchClick(region.target);
        return;
      }
    }
  }
}

export interface DashboardInputTransport {
  /** The only stream Ink should read; it delegates raw-mode ownership upstream. */
  stdin: PassThrough & NodeJS.ReadStream;
  mouse: DashboardMouseRegions;
  enableMouse(): void;
  /** Call after Ink unmounts. Disposes only transport-owned streams and modes. */
  dispose(): void;
}

type RawDashboardInput = NodeJS.ReadStream & {
  ref?: () => void;
  unref?: () => void;
};
type DashboardOutput = Writable & { isTTY?: boolean };

const MOUSE_MODE_ON = '\u001b[?1000h\u001b[?1006h';
const MOUSE_MODE_OFF = '\u001b[?1006l\u001b[?1000l';
const PENDING_ESCAPE_DELAY_MS = 20;
const MAX_MOUSE_SEQUENCE_LENGTH = 48;

function parseMouseReports(input: string, onMouse: (report: DashboardMouseReport) => void) {
  let output = '';
  let cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf('\u001b', cursor);
    if (start < 0) {
      output += input.slice(cursor);
      return { output, pending: '' };
    }
    output += input.slice(cursor, start);
    const suffix = input.slice(start);
    const prefix = '\u001b[<';
    if (prefix.startsWith(suffix) && suffix.length < prefix.length) {
      return { output, pending: suffix };
    }
    if (!suffix.startsWith(prefix)) {
      output += '\u001b';
      cursor = start + 1;
      continue;
    }

    let end = start + prefix.length;
    while (end < input.length && /[0-9;]/u.test(input[end])) end += 1;
    if (end === input.length) {
      const candidate = input.slice(start);
      if (candidate.length <= MAX_MOUSE_SEQUENCE_LENGTH) return { output, pending: candidate };
      output += candidate;
      return { output, pending: '' };
    }
    if (input[end] !== 'M' && input[end] !== 'm') {
      output += '\u001b';
      cursor = start + 1;
      continue;
    }

    const sequence = input.slice(start, end + 1);
    const match = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/u.exec(sequence);
    if (match) {
      const button = Number(match[1]);
      const x = Number(match[2]);
      const y = Number(match[3]);
      const modifierBits = button & 28;
      const baseButton = button & ~28;
      const leftRelease = match[4] === 'm' && (baseButton === 0 || baseButton === 3);
      const wheelPress = match[4] === 'M' && (baseButton === 64 || baseButton === 65);
      if (x > 0 && y > 0 && (leftRelease || wheelPress)) {
        onMouse({
          button: wheelPress ? baseButton : 0,
          x,
          y,
          modifiers: {
            shift: (modifierBits & 4) !== 0,
            alt: (modifierBits & 8) !== 0,
            ctrl: (modifierBits & 16) !== 0,
          },
        });
      }
    } else {
      output += sequence;
    }
    cursor = end + 1;
  }
  return { output, pending: '' };
}

/**
 * Put one fragmented-sequence-aware SGR mouse decoder in front of Ink's single
 * readable input consumer. Never attach a competing `data`/`readable` listener
 * to the source stream; pipe it through this owned transform instead.
 */
export function createDashboardInputTransport(
  sourceInput: RawDashboardInput,
  output: DashboardOutput,
): DashboardInputTransport {
  const mouse = new DashboardMouseRegions();
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let mouseModeEnabled = false;

  const clearPendingTimer = () => {
    clearTimeout(pendingTimer);
    pendingTimer = undefined;
  };
  const flushPending = (stream: Transform) => {
    clearPendingTimer();
    if (pending && !pending.startsWith('\u001b[<')) stream.push(pending);
    pending = '';
  };
  const transform = new Transform({
    transform(chunk: Buffer | string, _encoding, callback: TransformCallback) {
      clearPendingTimer();
      const text = pending + (typeof chunk === 'string' ? chunk : decoder.write(chunk));
      const parsed = parseMouseReports(text, (report) => mouse.dispatch(report));
      pending = parsed.pending;
      if (parsed.output) this.push(parsed.output);
      if (pending) {
        pendingTimer = setTimeout(() => flushPending(this), PENDING_ESCAPE_DELAY_MS);
      }
      callback();
    },
    flush(callback) {
      clearPendingTimer();
      const tail = decoder.end();
      const text = pending + tail;
      pending = '';
      if (text) this.push(text);
      callback();
    },
  });
  const inkInput = new PassThrough() as PassThrough & NodeJS.ReadStream;
  const rawModeInput = sourceInput as RawDashboardInput & {
    setRawMode?: (enabled: boolean) => unknown;
  };
  Object.defineProperties(inkInput, {
    isTTY: { configurable: true, value: sourceInput.isTTY === true },
    setRawMode: {
      configurable: true,
      value: (enabled: boolean) => {
        if (typeof rawModeInput.setRawMode !== 'function') {
          throw new Error('Dashboard input does not support raw terminal mode.');
        }
        rawModeInput.setRawMode(enabled);
      },
    },
    ref: { configurable: true, value: () => rawModeInput.ref?.() },
    unref: { configurable: true, value: () => rawModeInput.unref?.() },
    setEncoding: {
      configurable: true,
      value: (encoding: BufferEncoding) => {
        sourceInput.setEncoding(encoding);
        return PassThrough.prototype.setEncoding.call(inkInput, encoding);
      },
    },
  });
  const onSourceError = (error: Error) => inkInput.destroy(error);
  sourceInput.pipe(transform).pipe(inkInput);
  sourceInput.once('error', onSourceError);

  return {
    stdin: inkInput,
    mouse,
    enableMouse() {
      if (disposed || mouseModeEnabled || output.isTTY !== true) return;
      output.write(MOUSE_MODE_ON);
      mouseModeEnabled = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearPendingTimer();
      pending = '';
      if (mouseModeEnabled) {
        try {
          output.write(MOUSE_MODE_OFF);
        } catch {
          /* The owning terminal may already be closed. */
        }
        mouseModeEnabled = false;
      }
      sourceInput.unpipe(transform);
      sourceInput.removeListener('error', onSourceError);
      transform.unpipe(inkInput);
      transform.destroy();
      inkInput.destroy();
      sourceInput.pause();
    },
  };
}
