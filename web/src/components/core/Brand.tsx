import React from 'react';
import styles from './Brand.module.css';

export function Brand({ footer = false }: { footer?: boolean }) {
  return <a className={`${styles.brand}${footer ? ` ${styles.footerBrand}` : ''}`} href="/#top" aria-label="Kitia home" data-ga-event={footer ? 'footer_home' : 'header_home'}><span className={styles.mark} aria-hidden="true">K</span><span>kitia<span className={styles.period}>.</span></span></a>;
}
