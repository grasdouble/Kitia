import React from 'react';
import { useGoogleAnalytics } from './analytics';
import { HomePage } from './HomePage';
import { Header } from './components/core/Header';
import { Footer } from './components/core/Footer';
import { Changelog } from './components/sections/Changelog';

const DashboardDemo = React.lazy(() => import('./components/demo/DashboardDemo').then((module) => ({ default: module.DashboardDemo })));
const TuiDemo = React.lazy(() => import('./components/demo/TuiDemo').then((module) => ({ default: module.TuiDemo })));

export function App() {
  useGoogleAnalytics();
  const path = window.location.pathname.replace(/\/+$/, '');
  const isChangelog = path === '/changelog';
  const isDemo = path === '/demo';
  const isPreservedDemo = path === '/demo-keep';
  return <>
    <a className="skip-link" href="#main" aria-label="Skip to main content" data-ga-event="skip_to_content">Skip to content</a>
    <Header />
    {isDemo || isPreservedDemo ? <React.Suspense fallback={<main id="main" className="shell"><p>Loading demo…</p></main>}>{isPreservedDemo ? <DashboardDemo /> : <TuiDemo />}</React.Suspense> : isChangelog ? <Changelog /> : <HomePage />}
    <Footer />
  </>;
}
