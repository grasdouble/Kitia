import React from 'react';
import styles from './Automation.module.css';

const commands = [
  ['Validate catalogs', 'kitia validate', 'Run strict catalog validation as a CI gate; exits non-zero when validation fails.'],
  ['Audit a resource', 'kitia preview skill <id> --audit', 'Review local pattern-match findings and coverage before install; this is not a safety guarantee.'],
  ['Share pinned selections', 'kitia collection export · kitia collection import', 'Share selected, commit-pinned catalog references from the CLI. Signatures are optional; signed imports can be checked with an approved trusted key.'],
  ['Preview a change', 'kitia install skill <id> --dry-run --json', 'Review a machine-readable plan without changing files.'],
];

export function Automation() {
  return <section className={`shell ${styles.section}`} id="commands" aria-labelledby="commands-title"><div className={styles.heading}><div><p className={styles.eyebrow}>Automation when you need it</p><h2 id="commands-title">CLI for scripts<br />and CI.</h2></div><p>The dashboard is Kitia's interactive workspace. Use the CLI as a secondary interface for repeatable checks and machine-readable reports in your scripts and CI pipelines.</p></div><div className={styles.cards}>{commands.map(([label, command, description]) => <article className={styles.card} key={label}><span>{label}</span><code>{command}</code><p>{description}</p></article>)}</div></section>;
}
