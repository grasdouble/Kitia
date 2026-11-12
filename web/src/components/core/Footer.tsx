import React from 'react';
import { Brand } from './Brand';
import { contract, repo } from './siteConstants';
import styles from './Footer.module.css';

export function Footer() {
  return <footer className={`shell ${styles.footer}`}><Brand footer /><p>Interactive dashboard with CLI automation.</p><div className={styles.links}><a href="https://grasdouble.fr" aria-label="Visit grasdouble.fr" data-ga-event="footer_grasdouble">grasdouble.fr</a><a href={repo} aria-label="Visit the Kitia GitHub repository" data-ga-event="footer_repository">Repository</a><a href={`${repo}#readme`} aria-label="Read the Kitia README on GitHub" data-ga-event="footer_readme">README</a><a href="/changelog" aria-label="Read the Kitia changelog" data-ga-event="footer_changelog">Changelog</a><a href={contract} aria-label="Read the Kitia CLI contract" data-ga-event="footer_cli_contract">CLI contract</a></div><span className={styles.copyright}>© {new Date().getFullYear()} Kitia</span></footer>;
}
