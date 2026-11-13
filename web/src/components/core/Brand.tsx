import React from 'react';
import { Link } from '@tanstack/react-router';
import styles from './Brand.module.css';

export function Brand({ footer = false }: { footer?: boolean }) {
  return <Link className={`${styles.brand}${footer ? ` ${styles.footerBrand}` : ''}`} to="/" hash="top" aria-label="Kitia home" data-ga-event={footer ? 'footer_home' : 'header_home'}><span className={styles.mark} aria-hidden="true">K</span><span>kitia<span className={styles.period}>.</span></span></Link>;
}
