import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { InstallationTargets, InventoryWorkspace } from '../../application/snapshot.js';
import type { InstallationScope } from '../../core/installations/model.js';
import { BrowseCatalog } from './catalog.js';
import { Inventory, InventorySummary } from './inventory.js';
import { readSessionJson } from './session-api.js';

import './style.css';

type SessionInventory = InventoryWorkspace & { targets: InstallationTargets };

function App() {
  const [section, setSection] = useState<'inventory' | 'browse'>('inventory');
  const [scope, setScope] = useState<InstallationScope>('project');
  const [data, setData] = useState<{ snapshot: SessionInventory; token: string }>();
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
    void readSessionJson<SessionInventory>('/api/inventory', session, controller.signal).then(
      (snapshot) => setData({ snapshot, token: session }),
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load the inventory.');
      },
    );
    return () => controller.abort();
  }, []);

  return (
    <main>
      <header>
        <p className="eyebrow">Kitia · Local session</p>
        <h1>{section === 'inventory' ? 'Inventory' : 'Browse resources'}</h1>
      </header>
      <nav className="app-sections" aria-label="Kitia sections">
        <button type="button" aria-pressed={section === 'inventory'} onClick={() => setSection('inventory')}>
          Inventory
        </button>
        <button type="button" aria-pressed={section === 'browse'} onClick={() => setSection('browse')}>
          Browse resources
        </button>
      </nav>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">Loading inventory…</p>
      ) : section === 'browse' ? (
        <BrowseCatalog
          inventory={data.snapshot.inventory}
          targets={data.snapshot.targets}
          token={data.token}
          onInstalled={(inventory) => setData({ ...data, snapshot: { ...data.snapshot, inventory } })}
        />
      ) : (
        <>
          <InventorySummary inventory={data.snapshot.inventory} />
          <nav aria-label="Inventory scope">
            <button type="button" aria-pressed={scope === 'project'} onClick={() => setScope('project')}>
              Project
            </button>
            <button type="button" aria-pressed={scope === 'user'} onClick={() => setScope('user')}>
              User
            </button>
          </nav>
          <Inventory
            key={scope}
            data={data.snapshot}
            scope={scope}
            target={data.snapshot.targets[scope]}
            token={data.token}
          />
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
