import React from 'react';
import { HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router';
import { useGoogleAnalytics } from './analytics';
import { Header } from './components/core/Header';
import { Footer } from './components/core/Footer';

export function App() {
  useGoogleAnalytics();
  return <>
    <HeadContent />
    <Scripts />
    <Link className="skip-link" to="." hash="main" aria-label="Skip to main content" data-ga-event="skip_to_content">Skip to content</Link>
    <Header />
    <Outlet />
    <Footer />
  </>;
}
