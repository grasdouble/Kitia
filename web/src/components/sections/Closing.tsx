import React from 'react';
import { contract, repo } from '../core/siteConstants';
import styles from './Closing.module.css';

export function Closing() {
  return <section className={styles.section} aria-labelledby="closing-title"><div className={`shell ${styles.inner}`}><div><p className={styles.eyebrow}><span aria-hidden="true" />Open source · Your tools · Your choice</p><h2 id="closing-title">Start with a catalog<br />you already trust.</h2></div><div className={styles.actions}><a className={styles.button} href={`${repo}#readme`} aria-label="Get started with Kitia on GitHub" data-ga-event="closing_github_get_started">Get started on GitHub <span aria-hidden="true">↗</span></a><a href={contract} aria-label="Explore the Kitia CLI contract" data-ga-event="closing_cli_contract">Explore the CLI contract <span aria-hidden="true">→</span></a></div></div></section>;
}
