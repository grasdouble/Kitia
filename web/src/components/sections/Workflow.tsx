import React from 'react';

import styles from './Workflow.module.css';

const steps = [
  [
    'Install once',
    'Install Kitia globally, then run kitia to open the dashboard. For one-off use, run commands with npx.',
    'npm install --global @grasdouble/kitia',
  ],
  [
    'Start in your dashboard',
    'The interactive inventory brings project and user resources together, with details and attention items in one place.',
    'kitia',
  ],
  [
    'Browse and manage catalogs',
    'Search catalog metadata, tags, status, license, source, and descriptions; narrow results by resource type or license. Preview and audit current local inventory files from their detail views.',
    'I Inventory · B Browse resources · M Manage catalogs',
  ],
  [
    'Choose and confirm actions',
    'Install, update, or uninstall selected resources. Kitia protects files it does not manage and asks before dashboard actions.',
    'Enter install · U update · Delete uninstall',
  ],
  [
    'Keep Kitia up to date',
    'For global npm or pnpm installs, run this command and confirm, or choose Update when the dashboard announces a new version. Restart Kitia after updating.',
    'kitia self-update',
  ],
] as const;

export function Workflow() {
  return (
    <section className={`shell ${styles.section}`} id="workflow" aria-labelledby="workflow-title">
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Your workspace starts here</p>
        <h2 id="workflow-title">
          A TUI for
          <br />
          <em>the whole workflow.</em>
        </h2>
        <p>
          Explore your resources in Kitia's interactive terminal interface. Use the CLI when you want to automate
          repeatable checks.
        </p>
      </div>
      <div className={styles.steps}>
        {steps.map(([title, text, command], index) => (
          <article className={styles.step} key={title}>
            <span className={styles.number}>0{index + 1}</span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
              <code>{command}</code>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
