import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Brand } from './Brand';
import { repo } from './siteConstants';
import styles from './Header.module.css';

const links = [
  ['Home', '/', 'nav_home', 'Go to the home page'],
  ['Try demo', '/demo', 'nav_demo', 'Try the interactive dashboard demo'],
  ['Changelog', '/changelog', 'nav_changelog', 'Read the Kitia changelog'],
] as const;

export function Header() {
  const currentPath = useRouterState({ select: (state) => state.location.pathname.replace(/\/+$/, '') || '/' });
  const [menuOpen, setMenuOpen] = React.useState(false);
  return <header className={styles.header}><nav className={`shell ${styles.nav}`} aria-label="Main navigation"><Brand /><div className={`${styles.links}${menuOpen ? ` ${styles.open}` : ''}`} id="primary-navigation">{links.map(([label, href, event, description]) => <Link key={event} to={href} activeOptions={{ exact: true }} aria-label={description} aria-current={href === currentPath || (href === '/demo' && currentPath === '/demo-keep') ? 'page' : undefined} data-ga-event={event} onClick={() => setMenuOpen(false)}>{label}</Link>)}</div><a className={styles.github} href={repo} aria-label="Visit Kitia on GitHub" data-ga-event="header_github">GitHub <span aria-hidden="true">↗</span></a><button className={styles.toggle} type="button" aria-controls="primary-navigation" aria-expanded={menuOpen} aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setMenuOpen((open) => !open)}><span /><span /><span /></button></nav></header>;
}
