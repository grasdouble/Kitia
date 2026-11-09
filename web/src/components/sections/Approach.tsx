import React from 'react';
import { contract } from '../core/siteConstants';
import styles from './Approach.module.css';

const points = [
  ['Local metadata', 'Catalog definitions and metadata-only indexes live in your user configuration.'],
  ['Upstream content', 'Skill, agent, and instruction bodies stay in their source repositories.'],
  ['Explicit choices', 'You choose the catalogs and resources to add, preview, install, and manage.'],
  ['Conflict-aware', 'Managed-file tracking helps avoid overwriting content Kitia does not own.'],
];

export function Approach() {
  return <section className={styles.section} id="approach" aria-labelledby="approach-title"><div className={`shell ${styles.panel}`}><div className={styles.copy}><p className={styles.eyebrow}><span aria-hidden="true" />The Kitia approach</p><h2 id="approach-title">Catalog metadata stays local.<br /><em>Resources stay upstream.</em></h2><p className={styles.lede}>Kitia brings catalog metadata into your local configuration. The resource bodies remain in the repositories that publish them.</p><a className={styles.link} href={contract} aria-label="Read the Kitia CLI contract" data-ga-event="approach_cli_contract">Read the CLI contract <span aria-hidden="true">↗</span></a></div><dl className={styles.details}>{points.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl></div></section>;
}
