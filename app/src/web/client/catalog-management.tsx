import { useEffect, useState } from 'react';

import type { CatalogSnapshot } from '../../application/snapshot.js';
import type { checkCatalogFreshness } from '../../core/catalogs/manage.js';
import type { UserCatalog } from '../../core/catalogs/model.js';
import type { CatalogCommand, CatalogCommandResult } from '../catalog-contract.js';
import { CatalogEditor } from './catalog-editor.js';
import { CatalogExport, CatalogImport } from './catalog-transfer.js';
import { postSessionJson, readSessionJson } from './session-api.js';
import { SessionDialog } from './session-dialog.js';

type Dialog =
  | { kind: 'add' | 'import' | 'export' }
  | { kind: 'edit' | 'remove'; catalog: UserCatalog }
  | { kind: 'refresh'; name?: string };
type Freshness = Awaited<ReturnType<typeof checkCatalogFreshness>>;

export function CatalogManagement({ token, onChanged }: { token: string; onChanged: () => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<CatalogSnapshot>();
  const [loadError, setLoadError] = useState<string>();
  const [freshness, setFreshness] = useState<{ snapshot: CatalogSnapshot; statuses: Freshness }>();
  const [dialog, setDialog] = useState<Dialog>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Pick<CatalogCommandResult, 'messages' | 'warnings'>>();

  useEffect(() => {
    const controller = new AbortController();
    void readSessionJson<CatalogSnapshot>('/api/catalog', token, controller.signal).then(
      setSnapshot,
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(failure instanceof Error ? failure.message : 'Could not load the catalog configuration.');
      },
    );
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!snapshot?.catalogs.length) return;
    const controller = new AbortController();
    void readSessionJson<Freshness>('/api/catalog/freshness', token, controller.signal).then(
      (statuses) => {
        if (!controller.signal.aborted) setFreshness({ snapshot, statuses });
      },
      () => {
        if (!controller.signal.aborted) setFreshness({ snapshot, statuses: [] });
      },
    );
    return () => controller.abort();
  }, [snapshot, token]);

  function open(next?: Dialog) {
    setError(undefined);
    setDialog(next);
    if (next) setResult(undefined);
  }

  async function submit(command: CatalogCommand) {
    setBusy(true);
    setError(undefined);
    try {
      const { snapshot, messages, warnings } = await postSessionJson<CatalogCommandResult>(
        '/api/catalog/manage',
        token,
        command,
      );
      setSnapshot(snapshot);
      try {
        await onChanged();
      } catch (failure) {
        warnings.push(
          `The catalog operation finished, but Inventory could not be reloaded: ${failure instanceof Error ? failure.message : 'unknown error'}`,
        );
      }
      setResult({ messages, warnings });
      setDialog(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Catalog operation failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot) return loadError ? <p role="alert">{loadError}</p> : <p role="status">Loading catalogs…</p>;
  const counts = new Map<string | undefined, number>();
  for (const { catalog } of snapshot.resources) counts.set(catalog, (counts.get(catalog) ?? 0) + 1);
  const statuses = new Map(
    freshness?.snapshot === snapshot ? freshness.statuses.map(({ name, status }) => [name, status]) : [],
  );
  const progress = (name: string) =>
    snapshot.unavailable.includes(name)
      ? 'Unavailable'
      : freshness?.snapshot !== snapshot
        ? 'Checking…'
        : { current: 'Current', outdated: 'Update available', unknown: 'Unknown' }[statuses.get(name) ?? 'unknown'];

  return (
    <section className="panel" aria-label="Manage catalogs">
      <p>Catalog definitions and indexes apply to both the project and user scopes.</p>
      <div className="resource-actions">
        <button type="button" onClick={() => open({ kind: 'add' })}>
          Add catalog…
        </button>
        <button type="button" disabled={!snapshot.catalogs.length} onClick={() => open({ kind: 'refresh' })}>
          Refresh all…
        </button>
        <button type="button" onClick={() => open({ kind: 'import' })}>
          Import JSON…
        </button>
        <button type="button" onClick={() => open({ kind: 'export' })}>
          Export JSON…
        </button>
      </div>
      {result?.messages.length ? (
        <ul role="status">
          {result.messages.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      ) : null}
      {result?.warnings.length ? (
        <ul role="alert">
          {result.warnings.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      ) : null}
      {snapshot.warnings.length ? (
        <ul className="warnings" aria-label="Catalog warnings">
          {snapshot.warnings.map(({ catalog, message }) => (
            <li key={catalog}>{message}</li>
          ))}
        </ul>
      ) : null}
      {snapshot.catalogs.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Catalog</th>
                <th scope="col">Repository</th>
                <th scope="col">Mode</th>
                <th scope="col">Resources</th>
                <th scope="col">Index status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.catalogs.map((catalog) => (
                <tr key={catalog.name}>
                  <th scope="row">{catalog.name}</th>
                  <td>
                    <code>{catalog.repository}</code>
                  </td>
                  <td>{catalog.mode === 'custom' ? 'Custom' : 'Basic'}</td>
                  <td>{snapshot.unavailable.includes(catalog.name) ? '—' : (counts.get(catalog.name) ?? 0)}</td>
                  <td>{progress(catalog.name)}</td>
                  <td>
                    <div className="resource-actions">
                      <button
                        type="button"
                        aria-label={`Edit ${catalog.name}`}
                        onClick={() => open({ kind: 'edit', catalog })}
                      >
                        Edit…
                      </button>
                      <button
                        type="button"
                        aria-label={`Refresh ${catalog.name}`}
                        onClick={() => open({ kind: 'refresh', name: catalog.name })}
                      >
                        Refresh…
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${catalog.name}`}
                        onClick={() => open({ kind: 'remove', catalog })}
                      >
                        Remove…
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No catalogs configured.</p>
      )}
      {dialog ? (
        <SessionDialog
          title={
            dialog.kind === 'edit' || dialog.kind === 'remove'
              ? dialog.catalog.name
              : dialog.kind === 'refresh'
                ? (dialog.name ?? 'All catalogs')
                : 'Catalog configuration'
          }
          subtitle={
            {
              add: 'Add catalog',
              edit: 'Edit catalog',
              remove: 'Remove catalog',
              refresh: 'Refresh catalog indexes',
              import: 'Import catalogs',
              export: 'Export catalogs',
            }[dialog.kind]
          }
          closeLabel="Close catalog dialog"
          busy={busy}
          onClose={() => open()}
        >
          {dialog.kind === 'add' || dialog.kind === 'edit' ? (
            <CatalogEditor
              catalog={dialog.kind === 'edit' ? dialog.catalog : undefined}
              busy={busy}
              onSubmit={submit}
            />
          ) : dialog.kind === 'import' ? (
            <CatalogImport busy={busy} onSubmit={submit} />
          ) : dialog.kind === 'export' ? (
            <CatalogExport token={token} />
          ) : dialog.kind === 'remove' ? (
            <>
              <p>Remove this definition and its local index? Installed files will stay on disk.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit({ action: 'remove', name: dialog.catalog.name })}
              >
                Confirm removal
              </button>
            </>
          ) : dialog.kind === 'refresh' ? (
            <>
              <p>
                Retrieve{' '}
                {dialog.name
                  ? 'the current source and rebuild this index'
                  : 'the current sources and rebuild all indexes'}
                . Installed files will not be changed.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit({ action: 'refresh', name: dialog.name })}
              >
                Confirm refresh
              </button>
            </>
          ) : null}
          {busy ? <p role="status">Updating catalog configuration or indexes…</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </SessionDialog>
      ) : null}
    </section>
  );
}
