import React from 'react';
import { Brand } from './Brand';
import { repo } from './siteConstants';
import styles from './Header.module.css';

const links = [
  ['Home', '/', 'nav_home', 'Go to the home page'],
  ['Try demo', '/demo', 'nav_demo', 'Try the interactive dashboard demo'],
  ['Changelog', '/changelog', 'nav_changelog', 'Read the Kitia changelog'],
];

export function Header() {
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const [menuOpen, setMenuOpen] = React.useState(false);
  return <header className={styles.header}><nav className={`shell ${styles.nav}`} aria-label="Main navigation"><Brand /><div className={`${styles.links}${menuOpen ? ` ${styles.open}` : ''}`} id="primary-navigation">{links.map(([label, href, event, description]) => <a key={event} href={href} aria-label={description} aria-current={href === currentPath ? 'page' : undefined} data-ga-event={event} onClick={() => setMenuOpen(false)}>{label}</a>)}</div><a className={styles.github} href={repo} aria-label="Visit Kitia on GitHub" data-ga-event="header_github">GitHub <span aria-hidden="true">↗</span></a><button className={styles.toggle} type="button" aria-controls="primary-navigation" aria-expanded={menuOpen} aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setMenuOpen((open) => !open)}><span /><span /><span /></button></nav></header>;
}
