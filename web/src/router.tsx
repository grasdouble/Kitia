import React from 'react';
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Link, type RouterHistory } from '@tanstack/react-router';
import { App } from './App';
import { HomePage } from './HomePage';
import { Changelog } from './components/sections/Changelog';

function PendingPage() {
  return <main id="main" className="shell" aria-busy="true"><p>Loading page…</p></main>;
}

function NotFoundPage() {
  return <main id="main" className="shell"><h1>Page not found</h1><p>This page does not exist.</p><Link to="/">Return to the home page</Link></main>;
}

const rootRoute = createRootRoute({
  component: App,
  notFoundComponent: NotFoundPage,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
  head: () => ({ meta: [
    { title: 'Kitia — Choose your AI resources' },
    { name: 'description', content: 'Kitia connects external catalogs of skills, agents, and instructions to Claude Code and GitHub Copilot—while resource content stays in its upstream repository.' },
    { name: 'theme-color', content: '#f3f1eb' },
  ] }),
});

const demoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/demo',
  component: lazyRouteComponent(() => import('./components/demo/TuiDemo'), 'TuiDemo'),
  head: () => ({ meta: [
    { title: 'Kitia · Terminal Dashboard Demo' },
    { name: 'description', content: "Try Kitia's actual terminal dashboard in your browser, with the same screens and keyboard controls and safe sample data." },
    { name: 'theme-color', content: '#080e18' },
  ] }),
});

const preservedDemoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/demo-keep',
  component: lazyRouteComponent(() => import('./components/demo/DashboardDemo'), 'DashboardDemo'),
  head: () => ({ meta: [
    { title: 'Kitia · Preserved Dashboard Playground' },
    { name: 'description', content: 'The preserved web-style Kitia dashboard playground with browser-only sample actions.' },
    { name: 'theme-color', content: '#080e18' },
  ] }),
});

const changelogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/changelog',
  component: Changelog,
  head: () => ({ meta: [
    { title: 'Kitia Changelog' },
    { name: 'description', content: 'Kitia product updates, improvements, and fixes for each release.' },
    { name: 'theme-color', content: '#f3f1eb' },
  ] }),
});

export const routeTree = rootRoute.addChildren([homeRoute, demoRoute, preservedDemoRoute, changelogRoute]);

export function createAppRouter({ history }: { history?: RouterHistory } = {}) {
  return createRouter({
    routeTree,
    history,
    trailingSlash: 'never',
    scrollRestoration: true,
    scrollRestorationBehavior: 'instant',
    defaultPendingComponent: PendingPage,
    defaultPendingMs: 150,
    defaultPreload: 'intent',
    defaultPendingMinMs: 0,
  });
}

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
