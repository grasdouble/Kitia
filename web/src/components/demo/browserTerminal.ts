import type { ReactElement } from 'react';
import type { Instance } from 'ink';
import { XTERM_THEME } from './terminalTheme';

export interface BrowserTerminalSession {
  sendInput(data: string): void;
  focus(): void;
  dispose(): void;
}

/** Mount the installed Ink renderer in an isolated, focus-owned xterm terminal. */
export async function mountDashboardTerminal(
  container: HTMLElement,
  element: ReactElement,
  options: { onExit?: () => void } = {},
): Promise<BrowserTerminalSession> {
  const [{ Terminal }, { FitAddon }, { Readable, Writable }, { render }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('readable-stream'),
    import('ink'),
    import('@xterm/xterm/css/xterm.css'),
  ]);
  await document.fonts.ready;
  const terminalHost = document.createElement('div');
  terminalHost.style.width = '100%';
  terminalHost.style.height = '100%';
  terminalHost.style.minWidth = '0';
  terminalHost.style.overflow = 'hidden';
  container.append(terminalHost);

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
  const fitAddon = new FitAddon();
  let disposed = false;
  let exited = false;
  let resizeFrame = 0;
  let app: Instance | undefined;
  let observer: ResizeObserver | undefined;
  let inputSubscription: { dispose(): void } | undefined;
  let resizeSubscription: { dispose(): void } | undefined;

  const input = Object.assign(new Readable({ read() {} }), {
    isTTY: true,
    isRaw: false,
    setRawMode(enabled: boolean) {
      input.isRaw = enabled;
      return input;
    },
  });
  const output = Object.assign(new Writable({
    write(chunk, _encoding, callback) {
      if (disposed) {
        callback();
        return;
      }
      terminal.write(typeof chunk === 'string' ? chunk : new Uint8Array(chunk), callback);
    },
  }), {
    isTTY: true,
    columns: terminal.cols,
    rows: terminal.rows,
    getWindowSize: () => [terminal.cols, terminal.rows] as [number, number],
  });

  const dispose = () => {
    if (disposed) return;
    // Unmount while the output stream is still usable so Ink releases raw mode,
    // resize/input subscriptions, React effects, and Yoga nodes normally.
    try {
      app?.unmount();
    } finally {
      disposed = true;
      observer?.disconnect();
      cancelAnimationFrame(resizeFrame);
      inputSubscription?.dispose();
      resizeSubscription?.dispose();
      input.destroy();
      output.destroy();
      terminal.dispose();
      terminalHost.remove();
    }
  };
  const fit = () => {
    if (disposed) return;
    const dimensions = fitAddon.proposeDimensions();
    // Hidden or not-yet-laid-out containers retain the initial usable viewport.
    if (dimensions && dimensions.cols >= 2 && dimensions.rows >= 1) {
      terminal.resize(dimensions.cols, dimensions.rows);
    }
  };

  try {
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHost);
    terminal.textarea?.setAttribute('aria-label', 'Kitia terminal input');
    resizeSubscription = terminal.onResize(({ cols, rows }) => {
      output.columns = cols;
      output.rows = rows;
      output.emit('resize');
    });
    fit();
    inputSubscription = terminal.onData((data) => {
      if (!disposed && !exited) input.push(data);
    });
    observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fit);
    });
    observer.observe(container);
    app = render(element, {
      stdin: input,
      stdout: output,
      stderr: output,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
      alternateScreen: true,
    });
    // A render/initialization failure must reject the mount, not leave a blank
    // terminal behind an apparently successful session.
    await Promise.race([
      app.waitUntilRenderFlush(),
      app.waitUntilExit().then(() => { exited = true; }),
    ]);
    void app.waitUntilExit().then(() => {
      exited = true;
      if (!disposed) options.onExit?.();
    }, (error: unknown) => {
      exited = true;
      if (!disposed) {
        terminal.writeln(`\r\nTerminal error: ${error instanceof Error ? error.message : String(error)}`);
        options.onExit?.();
      }
    });
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    sendInput(data) {
      if (!disposed && !exited) input.push(data);
    },
    focus() {
      if (!disposed && !exited) terminal.focus();
    },
    dispose,
  };
}
