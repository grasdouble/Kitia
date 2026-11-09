import React from 'react';
import { Brand } from './Brand';
import { repo } from './siteConstants';
import styles from './Header.module.css';

const links = [
  ['Approach', '/#approach', 'nav_approach'],
  ['Dashboard', '/#dashboard', 'nav_dashboard'],
  ['Workflow', '/#workflow', 'nav_workflow'],
  ['Automation', '/#commands', 'nav_automation'],
  ['Changelog', '/changelog', 'nav_changelog'],
];

export function Header() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  return <header className={styles.header}><nav className={`shell ${styles.nav}`} aria-label="Main navigation"><Brand /><div className={`${styles.links}${menuOpen ? ` ${styles.open}` : ''}`} id="primary-navigation">{links.map(([label, href, event]) => <a key={event} href={href} aria-label={label === 'Automation' ? 'Navigate to the automation section' : label === 'Changelog' ? 'Read the Kitia changelog' : `Navigate to the ${label.toLowerCase()} section`} data-ga-event={event} onClick={() => setMenuOpen(false)}>{label}</a>)}</div><a className={styles.github} href={repo} aria-label="Visit Kitia on GitHub" data-ga-event="header_github">GitHub <span aria-hidden="true">↗</span></a><button className={styles.toggle} type="button" aria-controls="primary-navigation" aria-expanded={menuOpen} aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setMenuOpen((open) => !open)}><span /><span /><span /></button></nav></header>;
}
