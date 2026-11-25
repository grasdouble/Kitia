import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { InstallationTargets, InventorySnapshot } from '../../application/snapshot.js';
import type { InstallationScope } from '../../core/installations/model.js';

import './style.css';

type SessionInventory = { targets: InstallationTargets; inventory: InventorySnapshot };

function App() {
  const [scope, setScope] = useState<InstallationScope>('project');
  const [data, setData] = useState<SessionInventory>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get('session');
    if (token) {
      sessionStorage.setItem('kitia-session', token);
      history.replaceState(null, '', location.pathname);
    }
    const session = token || sessionStorage.getItem('kitia-session');
    if (!session) {
      setError('Open the session URL printed by kitia web.');
      return;
    }
    const controller = new AbortController();
    void fetch('/api/inventory', {
      headers: { Authorization: `Bearer ${session}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401)
          throw new Error('This session has expired. Open the current URL printed by kitia web.');
        if (!response.ok) throw new Error((await response.json()).error);
        setData(await response.json());
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load the inventory.');
      });
    return () => controller.abort();
  }, []);

  const rows = data?.inventory.resources.filter((resource) => resource.scope === scope);
  const issues = data?.inventory.errors.filter((issue) => issue.scope === scope || issue.scope === 'catalog');
  return (
    <main>
      <header>
        <p>Kitia · Local session</p>
        <h1>Inventory</h1>
      </header>
      <nav aria-label="Inventory scope">
        <button type="button" aria-pressed={scope === 'project'} onClick={() => setScope('project')}>
          Project
        </button>
        <button type="button" aria-pressed={scope === 'user'} onClick={() => setScope('user')}>
          User
        </button>
      </nav>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">Loading inventory…</p>
      ) : (
        <>
          <p>
            <code>{data.targets[scope]}</code>
          </p>
          {issues?.length ? (
            <ul aria-label="Inventory warnings">
              {issues.map((issue) => (
                <li key={`${issue.scope}:${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
          {rows?.length ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">Resource</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Catalog</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((resource) => (
                  <tr key={JSON.stringify([resource.catalog, resource.kind, resource.id, resource.paths])}>
                    <th scope="row">{resource.id}</th>
                    <td>{resource.kind}</td>
                    <td>{resource.catalog || '—'}</td>
                    <td>{resource.status || 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : !issues?.some((issue) => issue.scope === scope) ? (
            <p>No installed resources in this scope.</p>
          ) : null}
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
