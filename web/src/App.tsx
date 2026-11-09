import React from 'react';
import { useGoogleAnalytics } from './analytics';
import { Header } from './components/core/Header';
import { Footer } from './components/core/Footer';
import { Approach } from './components/sections/Approach';
import { Automation } from './components/sections/Automation';
import { Changelog } from './components/sections/Changelog';
import { Closing } from './components/sections/Closing';
import { DashboardPreview } from './components/sections/DashboardPreview';
import { Hero } from './components/sections/Hero';
import { TrustStrip } from './components/sections/TrustStrip';
import { Workflow } from './components/sections/Workflow';

export function App() {
  useGoogleAnalytics();
  const isChangelog = window.location.pathname.replace(/\/+$/, '') === '/changelog';
  return <>
    <a className="skip-link" href="#main" aria-label="Skip to main content" data-ga-event="skip_to_content">Skip to content</a>
    <Header />
    {isChangelog ? <Changelog /> : <main id="main"><Hero /><TrustStrip /><Approach /><DashboardPreview /><Workflow /><Automation /><Closing /></main>}
    <Footer />
  </>;
}
