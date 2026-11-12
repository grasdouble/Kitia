import React from 'react';
import styles from './TrustStrip.module.css';

export function TrustStrip() {
  return <div className={styles.strip} aria-label="Resource types and supported tools"><div className={`shell ${styles.inner}`}><span>One tool for the resources you choose</span><div><b>Skills</b><i>·</i><b>Agents</b><i>·</i><b>Instructions</b></div><span>Claude Code <i>+</i> GitHub Copilot</span></div></div>;
}
