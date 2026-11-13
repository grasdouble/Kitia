import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Approach } from './components/sections/Approach';
import { Automation } from './components/sections/Automation';
import { Closing } from './components/sections/Closing';
import { DashboardPreview } from './components/sections/DashboardPreview';
import { Hero } from './components/sections/Hero';
import { TrustStrip } from './components/sections/TrustStrip';
import { Workflow } from './components/sections/Workflow';
import styles from './HomePage.module.css';
import { scrollToSection } from './sectionScrolling';

const sections = [
  ['approach', 'Approach', 'nav_approach'],
  ['dashboard', 'Dashboard', 'nav_dashboard'],
  ['workflow', 'Workflow', 'nav_workflow'],
  ['commands', 'Automation', 'nav_automation'],
] as const;

export function HomePage() {
  const router = useRouter();
  const navigation = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const cancelSectionScroll = useRef<(() => void) | null>(null);
  const sectionRequest = useRef(0);
  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    const targets = sections.map(([id]) => document.getElementById(id)).filter((target): target is HTMLElement => target !== null);
    const header = document.querySelector('header');
    const wideLayout = window.matchMedia('(min-width: 1180px)');
    let frame = 0;
    let disposed = false;
    const update = () => {
      frame = 0;
      const threshold = wideLayout.matches
        ? (header?.getBoundingClientRect().bottom ?? 76) + 24
        : (navigation.current?.getBoundingClientRect().bottom ?? 120) + 16;
      const scrollY = Math.max(0, window.scrollY);
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      let active = '';
      for (const target of targets) {
        // Late sections must activate even when the page ends before their heading reaches the header.
        const activationY = Math.min(maxScrollY, scrollY + target.getBoundingClientRect().top - threshold);
        if (scrollY + 1 < activationY) break;
        active = target.id;
      }
      setActiveSection(active);
    };
    const schedule = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(content.current!);
    observer.observe(navigation.current!);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    schedule();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', schedule);
      sectionRequest.current++;
      cancelSectionScroll.current?.();
    };
  }, []);

  function navigateToSection(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const request = ++sectionRequest.current;
    cancelSectionScroll.current?.();
    void router.navigate({
      to: '/',
      hash: id,
      search: true,
      replace: router.latestLocation.hash === id,
      resetScroll: false,
      hashScrollIntoView: false,
    }).then(() => {
      if (request === sectionRequest.current && content.current?.contains(target)) {
        cancelSectionScroll.current = scrollToSection(target);
      }
    });
  }

  return <main id="main" className={styles.layout}>
    <nav ref={navigation} className={styles.sectionNav} aria-label="On this page">
      <p>On this page</p>
      <ol>{sections.map(([id, label, event]) => <li key={id}><a href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined} data-ga-event={event} onClick={(click) => navigateToSection(click, id)}>{label}</a></li>)}</ol>
    </nav>
    <div ref={content} className={styles.content}><Hero /><TrustStrip /><Approach /><DashboardPreview /><Workflow /><Automation /><Closing /></div>
  </main>;
}
