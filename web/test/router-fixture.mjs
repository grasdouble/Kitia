export async function createComponentRouter(element, { initialEntries = ['/'] } = {}) {
  const React = await import('react');
  const { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet } = await import('@tanstack/react-router');
  const rootRoute = createRootRoute({
    component: () => React.createElement(React.Fragment, null, element, React.createElement(Outlet)),
  });
  const routes = ['/', '/demo', '/demo-keep', '/changelog'].map((path) => createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => null,
  }));
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries }),
    scrollRestoration: true,
  });
  await router.load();
  return router;
}
