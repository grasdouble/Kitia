import React, { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from '@tanstack/react-router';
import { Dashboard } from '../../../../cli/src/dashboard/dashboard.mjs';
import { DASHBOARD_THEME } from '../../../../cli/src/dashboard/colors';
import { mountDashboardTerminal, type BrowserTerminalSession } from './browserTerminal';
import { createTuiDemoSession } from './tuiDemoSession';
import { terminalColor } from './terminalTheme';
import styles from './TuiDemo.module.css';

type Phase = 'loading' | 'ready' | 'ended' | 'error';

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
  ['1', 'Inventory'], ['2', 'Browse resources'], ['3', 'Catalogs'],
  ['A', 'Browse / add'], ['U', 'Update'], ['P', 'Preview / presets'], ['V', 'Revisions'],
  ['F', 'Search'], ['C', 'Catalog filter'], ['K', 'Kind filter'], ['L', 'License filter'],
  ['D', 'Toggle details'], ['M', 'Manage catalogs'], ['N', 'Connect catalog'],
  ['E', 'Edit catalog'], ['R', 'Refresh catalogs'], ['I', 'Import catalogs'], ['X', 'Export catalogs'],
  ['?', 'Guide'], ['Y', 'Confirm'], ['Q', 'Quit'],
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
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const session = createTuiDemoSession();
    void mountDashboardTerminal(container.current!, (mouse) => (
      <Dashboard {...session} mouse={mouse} onFinish={() => { if (active) setPhase('ended'); }} />
    ), { signal: controller.signal }).then((mounted) => {
      if (!active) {
        mounted.dispose();
        return;
      }
      terminal.current = mounted;
      setPhase('ready');
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase('error');
    });
    return () => {
      active = false;
      controller.abort();
      terminal.current?.dispose();
      terminal.current = null;
    };
  }, [generation]);

  useEffect(() => {
    if (phase !== 'ended') return;
    terminal.current?.dispose();
    terminal.current = null;
  }, [phase]);

  function reset() {
    setError('');
    setPhase('loading');
    setGeneration((value) => value + 1);
  }

  function sendKey(value: string) {
    terminal.current?.sendInput(value);
  }

  return <main id="main" className={`shell ${styles.page}`} style={themeStyle}>
    <div className={styles.intro}><div><p className={styles.eyebrow}>The terminal dashboard · in your browser</p><h1>Try the real interface.</h1><p>The same dashboard components, screens, mouse interactions, and keyboard controls as the Kitia TUI.</p></div><Link to="/" hash="commands" data-ga-event="demo_install_cli">Get the CLI <span aria-hidden="true">↗</span></Link></div>
    <p className={styles.notice}><strong>Safe demo workspace.</strong> The interface is real; catalog data and operations are simulated in memory. No GitHub access, local file changes, or security audits. Audit wording inside the TUI is illustrative here. Reset or reload restores the sample workspace.</p>
    <section className={styles.workspace} aria-label="Terminal dashboard playground">
      <header className={styles.toolbar}><span>kitia dashboard <span className={styles.demoLabel}>DEMO</span></span><div><button type="button" disabled={phase !== 'ready'} onClick={() => terminal.current?.focus()}>Focus terminal</button><button type="button" onClick={reset}>{phase === 'ended' ? 'Restart demo' : 'Reset demo'}</button></div></header>
    <p id="terminal-instructions" className={styles.instructions}>Click tabs, filters, options, rows, actions, and confirmation choices in the terminal, or click inside it and use your keyboard. Press <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> to switch sections; <kbd>Tab</kbd>/<kbd>Shift+Tab</kbd> moves between controls, and arrows plus <kbd>Enter</kbd> select. Press <kbd>?</kbd> for the guide. When search is focused, type normally; numbers are text. The buttons below send the same keys.</p>
      <div className={styles.screen}>
        <div ref={container} className={styles.terminal} role="group" aria-label="Kitia terminal" aria-describedby="terminal-instructions" />
        {phase !== 'ready' && <div className={styles.overlay} role={phase === 'error' ? 'alert' : 'status'}>
          {phase === 'loading' ? <p>Starting terminal…</p> : phase === 'ended' ? <><h2>Session ended.</h2><p>Restart to explore a fresh sample workspace.</p><button type="button" onClick={reset}>Restart terminal</button></> : <><h2>Unable to start the terminal.</h2><p className={styles.error}>{error}</p><button type="button" onClick={reset}>Try again</button></>}
        </div>}
      </div>
      <div className={styles.keyboard} aria-label="Terminal keyboard controls">
        <div className={styles.keyRow}>{navigationKeys.map(([label, value, name]) => <button key={name} type="button" aria-label={`Send ${name} to terminal`} disabled={phase !== 'ready'} onClick={() => sendKey(value)}>{label}</button>)}</div>
        <details><summary>Action keys</summary><p>Keys follow the current TUI screen; in text fields, they enter text instead of triggering actions.</p><div className={styles.actionKeys}>{actionKeys.map(([key, label]) => <button type="button" key={key} disabled={phase !== 'ready'} onClick={() => sendKey(key.toLowerCase())}><kbd>{key}</kbd>{label}</button>)}<button type="button" disabled={phase !== 'ready'} onClick={() => sendKey('\u001b[3~')}><kbd>Del</kbd>Uninstall / remove</button></div></details>
      </div>
    </section>
    <div className={styles.notes}><p>This runs the shared TUI, not a video or a recreation of its screens. Only the operation handlers use sample data. Real repositories, filesystem safety checks, and security audits require the installed CLI.</p><p>Prefer the earlier web-style playground? <Link to="/demo-keep">Open the preserved demo.</Link></p></div>
  </main>;
}
