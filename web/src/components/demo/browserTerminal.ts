import {
  createDashboardInputTransport,
  type DashboardInputTransport,
  type DashboardMouseRegions,
} from '@grasdouble/kitia/src/tui/input-transport.mts';
import type { Instance } from 'ink';
import type { ReactElement } from 'react';

import { XTERM_THEME } from './terminalTheme';

export interface BrowserTerminalSession {
  sendInput(data: string): void;
  focus(): void;
  dispose(): void;
}

export type BrowserTerminalExit = { status: 'ended' } | { status: 'error'; cause: unknown };

/** Mount the installed Ink renderer in an isolated, focus-owned xterm terminal. */
export async function mountDashboardTerminal(
  container: HTMLElement,
  createElement: (mouse: DashboardMouseRegions, finish: () => void) => ReactElement,
  { onExit, signal }: { onExit?: (exit: BrowserTerminalExit) => void; signal?: AbortSignal } = {},
): Promise<BrowserTerminalSession | undefined> {
  signal?.throwIfAborted();
  const abort = signal ? Promise.withResolvers<never>() : undefined;
  const interruptible = <T>(task: Promise<T>) => (abort ? Promise.race([task, abort.promise]) : task);
  let disposeBridge: (() => void) | undefined;
  const onAbort = () => {
    try {
      disposeBridge?.();
      abort?.reject(signal?.reason);
    } catch (error) {
      abort?.reject(error);
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const [{ Terminal }, { FitAddon }, { Readable, Writable }, { render }] = await interruptible(
      Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('readable-stream'),
        import('ink'),
        import('@xterm/xterm/css/xterm.css'),
      ]),
    );
    signal?.throwIfAborted();
    const document = container.ownerDocument;
    await interruptible(document.fonts.ready);
    signal?.throwIfAborted();

    const terminalHost = document.createElement('div');
    terminalHost.style.width = '100%';
    terminalHost.style.height = '100%';
    terminalHost.style.minWidth = '0';
    terminalHost.style.overflow = 'hidden';
    const terminal = new Terminal({
      cols: 100,
      rows: 40,
      screenReaderMode: true,
      cursorBlink: false,
      cursorStyle: 'bar',
      convertEol: true,
      scrollback: 0,
      fontSize: 12,
      lineHeight: 1.15,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      theme: XTERM_THEME,
    });
    let disposed = false;
    let ready = false;
    let exit: BrowserTerminalExit | undefined;
    const exited = Promise.withResolvers<void>();
    let app: Instance | undefined;
    let observer: ResizeObserver | undefined;
    let inputSubscription: { dispose(): void } | undefined;
    let resizeSubscription: { dispose(): void } | undefined;
    let inputTransport: DashboardInputTransport | undefined;
    let pendingWrite: (() => void) | undefined;

    const input = Object.assign(new Readable({ read() {} }), {
      isTTY: true,
      isRaw: false,
      setRawMode(enabled: boolean) {
        input.isRaw = enabled;
        return input;
      },
    });
    const output = Object.assign(
      new Writable({
        write(chunk, _encoding, callback) {
          if (disposed) {
            callback();
            return;
          }
          const complete = () => {
            if (pendingWrite !== complete) return;
            pendingWrite = undefined;
            callback();
          };
          pendingWrite = complete;
          terminal.write(typeof chunk === 'string' ? chunk : new Uint8Array(chunk), complete);
        },
      }),
      {
        isTTY: true,
        columns: terminal.cols,
        rows: terminal.rows,
        getWindowSize: () => [terminal.cols, terminal.rows] as [number, number],
      },
    );

    function dispose() {
      if (disposed) return;
      disposed = true;
      signal?.removeEventListener('abort', onAbort);
      observer?.disconnect();
      inputSubscription?.dispose();
      resizeSubscription?.dispose();
      try {
        app?.unmount();
      } finally {
        try {
          inputTransport?.dispose();
        } finally {
          // Ink can be waiting for a write callback. Release it even if xterm
          // has not drained its queue; subsequent teardown writes are discarded.
          pendingWrite?.();
          input.destroy();
          output.destroy();
          try {
            terminal.dispose();
          } finally {
            terminalHost.remove();
          }
        }
      }
    }

    function notifyExit(result: BrowserTerminalExit) {
      try {
        dispose();
      } catch (cause) {
        if (result.status !== 'error') result = { status: 'error', cause };
      }
      onExit?.(result);
    }

    function stop(result: BrowserTerminalExit) {
      if (disposed || exit) return;
      exit = result;
      if (ready) notifyExit(result);
      else exited.resolve();
    }

    disposeBridge = dispose;
    const fitAddon = new FitAddon();
    const fit = () => {
      if (disposed) return;
      const dimensions = fitAddon.proposeDimensions();
      // Hidden or not-yet-laid-out containers retain the initial usable viewport.
      if (dimensions && dimensions.cols >= 2 && dimensions.rows >= 1) {
        terminal.resize(dimensions.cols, dimensions.rows);
      }
    };
    inputTransport = createDashboardInputTransport(
      input as unknown as Parameters<typeof createDashboardInputTransport>[0],
      output as unknown as Parameters<typeof createDashboardInputTransport>[1],
    );
    const element = createElement(inputTransport.mouse, () => stop({ status: 'ended' }));
    signal?.throwIfAborted();
    container.append(terminalHost);
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHost);
    terminal.textarea?.setAttribute('aria-label', 'Kitia terminal input');
    resizeSubscription = terminal.onResize(({ cols, rows }) => {
      if (disposed) return;
      output.columns = cols;
      output.rows = rows;
      output.emit('resize');
    });
    fit();
    inputSubscription = terminal.onData((data) => {
      if (!disposed) input.push(data);
    });
    observer = new ResizeObserver(fit);
    observer.observe(container);
    app = render(element, {
      stdin: inputTransport.stdin,
      stdout: output,
      stderr: output,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
      alternateScreen: true,
    });
    void app.waitUntilExit().then(
      () => stop({ status: 'ended' }),
      (cause: unknown) => stop({ status: 'error', cause }),
    );
    inputTransport.enableMouse();
    await interruptible(Promise.race([app.waitUntilRenderFlush(), exited.promise]));
    signal?.throwIfAborted();
    if (exit) {
      if (exit.status === 'error') throw exit.cause;
      notifyExit(exit);
      return undefined;
    }
    ready = true;
    return {
      sendInput(data) {
        if (!disposed) input.push(data);
      },
      focus() {
        if (!disposed) terminal.focus();
      },
      dispose,
    };
  } catch (error) {
    signal?.removeEventListener('abort', onAbort);
    disposeBridge?.();
    throw error;
  }
}
