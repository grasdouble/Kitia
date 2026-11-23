import { HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router';
import React from 'react';

import { useGoogleAnalytics } from './analytics';
import { Footer } from './components/core/Footer';
import { Header } from './components/core/Header';

export function App() {
  useGoogleAnalytics();
  return (
    <>
      <HeadContent />
      <Scripts />
      <Link className="skip-link" to="." hash="main" aria-label="Skip to main content" data-ga-event="skip_to_content">
        Skip to content
      </Link>
      <Header />
      <Outlet />
      <Footer />
    </>
  );
}
