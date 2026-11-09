import React from 'react';
import changelog from '../../../../CHANGELOG.md?raw';
import { repo } from '../core/siteConstants';
import styles from './Changelog.module.css';

type Change = { message: string; details: string[] };
type ReleaseSection = { title: string; changes: Change[] };
type Release = { version: string; sections: ReleaseSection[] };

function parseReleases(source: string): Release[] {
  const normalizedSource = source.replace(/\r\n?/g, '\n');
  return normalizedSource.split(/^## /m).slice(1).map((entry) => {
    const [version, ...lines] = entry.split('\n');
    const sections: ReleaseSection[] = [];
    let currentSection: ReleaseSection | undefined;
    let currentChange: Change | undefined;

    for (const line of lines) {
      const heading = line.match(/^### (.+)/);
      if (heading) {
        currentSection = { title: heading[1], changes: [] };
        sections.push(currentSection);
        currentChange = undefined;
        continue;
      }

      const change = line.match(/^- (.+)/);
      if (change) {
        currentSection ??= { title: 'Release notes', changes: [] };
        if (!sections.includes(currentSection)) sections.push(currentSection);
        currentChange = { message: change[1], details: [] };
        currentSection.changes.push(currentChange);
        continue;
      }

      const detail = line.match(/^\s+- (.+)/);
      if (detail && currentChange) currentChange.details.push(detail[1]);
    }

    return { version, sections };
  });
}

function ChangeSummary({ message }: { message: string }) {
  const commit = message.match(/^([a-f0-9]{7,40}):\s+(.+)$/i);
  return <p>{commit ? <><a className={styles.commit} href={`${repo}/commit/${commit[1]}`} aria-label={`View commit ${commit[1]} on GitHub`}>{commit[1]}</a><span aria-hidden="true"> · </span>{commit[2]}</> : message}</p>;
}

export function Changelog() {
  const releases = parseReleases(changelog);
  return <main id="main" className={`shell ${styles.page}`}><header className={styles.heading}><p className={styles.eyebrow}>Kitia · Release notes</p><h1>Changelog</h1><p>Product updates, improvements, and fixes for each Kitia release. Share a direct link to any version.</p></header>{releases.map((release) => {
    const anchor = `release-${release.version}`;
    return <article className={styles.release} key={release.version} aria-labelledby={anchor}><header className={styles.releaseHeader}><div><p className={styles.versionLabel}>Version</p><h2 id={anchor}>{release.version}</h2></div><a className={styles.permalink} href={`#${anchor}`} aria-label={`Permalink to version ${release.version}`}>Permalink <span aria-hidden="true">↗</span></a></header>{release.sections.map((section) => <section className={styles.releaseSection} key={section.title}><h3>{section.title}</h3><ul className={styles.changeList}>{section.changes.map((change) => <li key={change.message}><ChangeSummary message={change.message} />{change.details.length > 0 && <ul className={styles.details}>{change.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}</li>)}</ul></section>)}</article>;
  })}</main>;
}
