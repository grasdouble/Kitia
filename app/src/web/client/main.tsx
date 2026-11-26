import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { InstallationTargets, InventorySnapshot, InventoryWorkspace } from '../../application/snapshot.js';
import type { InstallationScope } from '../../core/installations/model.js';
import type { SessionInfo } from '../maintenance-contract.js';
import { CatalogManagement } from './catalog-management.js';
import { BrowseCatalog } from './catalog.js';
import { Inventory, InventorySummary } from './inventory.js';
import { GettingStarted, guideSteps, MigrationNotice, VersionMaintenance } from './maintenance.js';
import { postSessionJson, readSessionJson } from './session-api.js';

import './style.css';

type SessionInventory = InventoryWorkspace & { targets: InstallationTargets };

function App() {
  const [section, setSection] = useState<'inventory' | 'browse' | 'catalogs'>('inventory');
  const [scope, setScope] = useState<InstallationScope>('project');
  const [showUnmanaged, setShowUnmanaged] = useState(false);
  const [data, setData] = useState<{ snapshot: SessionInventory; token: string; info: SessionInfo }>();
  const [guide, setGuide] = useState<number>();
  const [guideError, setGuideError] = useState<string>();
  const [stopped, setStopped] = useState(false);
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
    void Promise.all([
      readSessionJson<SessionInventory>('/api/inventory', session, controller.signal),
      readSessionJson<SessionInfo>('/api/session', session, controller.signal),
    ]).then(
      ([snapshot, info]) => {
        if (controller.signal.aborted) return;
        setData({ snapshot, token: session, info });
        if (info.showOnboarding) setGuide(0);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load the inventory.');
      },
    );
    return () => controller.abort();
  }, []);

  function refreshInventory(inventory: InventorySnapshot) {
    setData((current) => current && { ...current, snapshot: { ...current.snapshot, inventory } });
  }

  async function reloadInventory() {
    if (!data) return;
    const snapshot = await readSessionJson<SessionInventory>('/api/inventory', data.token, AbortSignal.timeout(30_000));
    setData((current) => current && { ...current, snapshot });
  }

  function showStep(step: number) {
    setGuide(step);
    setSection(guideSteps[step].section);
  }

  async function closeGuide() {
    setGuide(undefined);
    if (!data?.info.showOnboarding) return;
    setGuideError(undefined);
    try {
      await postSessionJson('/api/onboarding/complete', data.token);
      setData((current) => current && { ...current, info: { ...current.info, showOnboarding: false } });
    } catch (failure) {
      setGuideError(
        failure instanceof Error
          ? `Could not save guide completion: ${failure.message}`
          : 'Could not save guide completion.',
      );
    }
  }

  if (stopped)
    return (
      <main>
        <h1>Kitia web session closed</h1>
        <p>
          Update requested. Follow the result in the launch terminal, then run <code>kitia web</code> again.
        </p>
      </main>
    );

  return (
    <main>
      <header>
        <p className="eyebrow">
          Kitia{data && data.info.version !== 'unknown' ? ` ${data.info.version}` : ''} · Local session
        </p>
        <h1>{section === 'inventory' ? 'Inventory' : section === 'browse' ? 'Browse resources' : 'Catalogs'}</h1>
      </header>
      {data ? (
        <>
          <button type="button" onClick={() => showStep(0)}>
            Getting started
          </button>
          {guideError ? <p role="alert">{guideError}</p> : null}
          <VersionMaintenance token={data.token} onStopped={() => setStopped(true)} />
          <MigrationNotice inventory={data.snapshot.inventory} targets={data.snapshot.targets} />
        </>
      ) : null}
      <nav className="app-sections" aria-label="Kitia sections">
        <button type="button" aria-pressed={section === 'inventory'} onClick={() => setSection('inventory')}>
          Inventory
        </button>
        <button type="button" aria-pressed={section === 'browse'} onClick={() => setSection('browse')}>
          Browse resources
        </button>
        <button type="button" aria-pressed={section === 'catalogs'} onClick={() => setSection('catalogs')}>
          Catalogs
        </button>
      </nav>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">Loading inventory…</p>
      ) : section === 'catalogs' ? (
        <CatalogManagement token={data.token} onChanged={reloadInventory} />
      ) : section === 'browse' ? (
        <BrowseCatalog
          inventory={data.snapshot.inventory}
          targets={data.snapshot.targets}
          token={data.token}
          onInstalled={refreshInventory}
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
            showUnmanaged={showUnmanaged}
            onShowUnmanagedChange={setShowUnmanaged}
            onChanged={refreshInventory}
          />
        </>
      )}
      {guide !== undefined ? <GettingStarted step={guide} onStep={showStep} onClose={() => void closeGuide()} /> : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
