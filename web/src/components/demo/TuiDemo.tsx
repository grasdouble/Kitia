import { version as terminalVersion } from '@grasdouble/kitia/package.json';
import { DASHBOARD_THEME } from '@grasdouble/kitia/src/tui/colors.ts';
import { Dashboard } from '@grasdouble/kitia/src/tui/dashboard.mts';
import { Link } from '@tanstack/react-router';
import React, { useEffect, useRef, useState, type CSSProperties } from 'react';

import { mountDashboardTerminal, type BrowserTerminalSession } from './browserTerminal';
import { terminalColor } from './terminalTheme';
import { createTuiDemoSession } from './tuiDemoSession';

import styles from './TuiDemo.module.css';

type Phase = 'loading' | 'ready' | 'ended' | 'startup-error' | 'error';

const navigationKeys = [
  ['↑', '\u001b[A', 'Up arrow'],
  ['↓', '\u001b[B', 'Down arrow'],
  ['←', '\u001b[D', 'Left arrow'],
  ['→', '\u001b[C', 'Right arrow'],
  ['Enter', '\r', 'Enter'],
  ['Esc', '\u001b', 'Escape'],
  ['Tab', '\t', 'Tab'],
  ['⌫', '\u007f', 'Backspace'],
  ['Space', ' ', 'Space'],
  ['PgUp', '\u001b[5~', 'Page Up'],
  ['PgDn', '\u001b[6~', 'Page Down'],
] as const;
const actionKeys = [
  ['I', 'Inventory'],
  ['B', 'Browse resources'],
  ['M', 'Manage Catalogs'],
  ['A', 'Add catalog'],
  ['U', 'Update'],
  ['P', 'Preview / presets'],
  ['V', 'Revisions'],
  ['F', 'Search'],
  ['C', 'Catalog filter'],
  ['K', 'Kind filter'],
  ['L', 'License filter'],
  ['D', 'Toggle details'],
  ['E', 'Edit catalog'],
  ['R', 'Refresh catalogs'],
  ['Shift+I', 'Import catalogs', 'I'],
  ['X', 'Export catalogs'],
  ['?', 'Guide'],
  ['Y', 'Confirm'],
  ['Q', 'Quit'],
] as const;
const { accents } = DASHBOARD_THEME.semantic;
const themeStyle = {
  '--tui-background': 'var(--surface)',
  '--tui-surface': 'var(--surface)',
  '--tui-border': 'var(--line)',
  '--tui-text': terminalColor(accents.label),
  '--tui-muted': terminalColor(accents.muted),
  '--tui-primary': terminalColor(accents.primary),
  '--tui-selected': terminalColor(DASHBOARD_THEME.semantic.selected),
  '--tui-error': terminalColor(accents.error),
} as CSSProperties;

export function TuiDemo() {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<BrowserTerminalSession | null>(null);
  const mount = useRef<AbortController | null>(null);
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    mount.current = controller;
    const { signal } = controller;
    let finished = false;
    const session = createTuiDemoSession();
    void mountDashboardTerminal(
      container.current!,
      (mouse, finish) => <Dashboard {...session} versionLabel={terminalVersion} mouse={mouse} onFinish={finish} />,
      {
        signal,
        onExit(exit) {
          if (signal.aborted) return;
          finished = true;
          terminal.current = null;
          if (exit.status === 'error') {
            setError(exit.cause instanceof Error ? exit.cause.message : String(exit.cause));
            setPhase('error');
          } else {
            setPhase('ended');
          }
        },
      },
    )
      .then((mounted) => {
        if (!mounted) return;
        if (signal.aborted || finished) {
          mounted.dispose();
          return;
        }
        terminal.current = mounted;
        setPhase('ready');
      })
      .catch((cause: unknown) => {
        if (signal.aborted || finished) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setPhase('startup-error');
      });
    return () => {
      controller.abort();
      if (mount.current === controller) {
        mount.current = null;
        terminal.current = null;
      }
    };
  }, [generation]);

  const hasError = phase === 'startup-error' || phase === 'error';

  function reset() {
    mount.current?.abort();
    terminal.current = null;
    setError('');
    setPhase('loading');
    setGeneration((value) => value + 1);
  }

  function sendKey(value: string) {
    terminal.current?.sendInput(value);
  }

  return (
    <main id="main" className={`shell ${styles.page}`} style={themeStyle}>
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>The terminal dashboard · in your browser</p>
          <h1>Try the real interface.</h1>
          <p>The same dashboard components, screens, mouse interactions, and keyboard controls as the Kitia TUI.</p>
        </div>
        <Link to="/" hash="commands" data-ga-event="demo_install_cli">
          Get the CLI <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <p className={styles.notice}>
        <strong>Safe demo workspace.</strong> The interface is real; catalog data and operations are simulated in
        memory. No GitHub access, local file changes, or security audits. Audit wording inside the TUI is illustrative
        here. Reset or reload restores the sample workspace.
      </p>
      <section className={styles.workspace} aria-label="Terminal dashboard playground">
        <header className={styles.toolbar}>
          <span>
            kitia dashboard <span className={styles.demoLabel}>DEMO</span>
          </span>
          <div>
            <button type="button" disabled={phase !== 'ready'} onClick={() => terminal.current?.focus()}>
              Focus terminal
            </button>
            <button type="button" onClick={reset}>
              {phase === 'ended' ? 'Restart demo' : 'Reset demo'}
            </button>
          </div>
        </header>
        <p id="terminal-instructions" className={styles.instructions}>
          Click tabs, filters, rows, actions, and confirmation choices in the terminal. Use the mouse wheel over lists
          or details, or to page through the active preview pane. Click inside the terminal to use your keyboard. Press{' '}
          <kbd>I</kbd> for Inventory, <kbd>B</kbd> to browse resources, or <kbd>M</kbd> to manage catalogs.{' '}
          <kbd>Tab</kbd>/<kbd>Shift+Tab</kbd> moves between controls. In Install Options, open Scope or Destinations
          with a click, <kbd>Enter</kbd>, or <kbd>Space</kbd>. Use arrows and <kbd>Enter</kbd> to pick a scope, or{' '}
          <kbd>Space</kbd> to toggle destinations. Use <kbd>Tab</kbd> to reach Review install or Cancel, then{' '}
          <kbd>Enter</kbd> or <kbd>Space</kbd> to activate the button. <kbd>Esc</kbd> closes the menu or leaves Install
          Options. Press <kbd>?</kbd> for the guide. When search is focused, type normally. The buttons below send the
          same keys.
        </p>
        <div className={styles.screen}>
          <div
            ref={container}
            className={styles.terminal}
            role="group"
            aria-label="Kitia terminal"
            aria-describedby="terminal-instructions"
          />
          {phase !== 'ready' && (
            <div className={styles.overlay} role={hasError ? 'alert' : 'status'}>
              {phase === 'loading' ? (
                <p>Starting terminal…</p>
              ) : phase === 'ended' ? (
                <>
                  <h2>Session ended.</h2>
                  <p>Restart to explore a fresh sample workspace.</p>
                  <button type="button" onClick={reset}>
                    Restart terminal
                  </button>
                </>
              ) : (
                <>
                  <h2>{phase === 'startup-error' ? 'Unable to start the terminal.' : 'The terminal stopped.'}</h2>
                  <p className={styles.error}>{error}</p>
                  <button type="button" onClick={reset}>
                    Try again
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className={styles.keyboard} aria-label="Terminal keyboard controls">
          <div className={styles.keyRow}>
            {navigationKeys.map(([label, value, name]) => (
              <button
                key={name}
                type="button"
                aria-label={`Send ${name} to terminal`}
                disabled={phase !== 'ready'}
                onClick={() => sendKey(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <details>
            <summary>Action keys</summary>
            <p>Keys follow the current TUI screen; in text fields, they enter text instead of triggering actions.</p>
            <div className={styles.actionKeys}>
              {actionKeys.map(([key, label, value = key.toLowerCase()]) => (
                <button type="button" key={key} disabled={phase !== 'ready'} onClick={() => sendKey(value)}>
                  <kbd>{key}</kbd>
                  {label}
                </button>
              ))}
              <button type="button" disabled={phase !== 'ready'} onClick={() => sendKey('\u001b[3~')}>
                <kbd>Del</kbd>Uninstall / remove
              </button>
            </div>
          </details>
        </div>
      </section>
      <div className={styles.notes}>
        <p>
          This runs the shared TUI, not a video or a recreation of its screens. Only the operation handlers use sample
          data. Real repositories, filesystem safety checks, and security audits require the installed CLI.
        </p>
        <p>
          Prefer the earlier web-style playground? <Link to="/demo-keep">Open the preserved demo.</Link>
        </p>
      </div>
    </main>
  );
}
