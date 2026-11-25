import { useState } from 'react';

import type { ResourceActionResult } from '../../application/resource-actions.js';
import type { InstallationTargets, InventorySnapshot } from '../../application/snapshot.js';
import {
  availableInstallationDestinations,
  installationPath,
  installationScopes,
  resolveInstallationDestinations,
  type InstallationDestination,
} from '../../core/installations/destinations.js';
import type { InstallationScope } from '../../core/installations/model.js';
import type { CatalogResource } from '../../core/resources/model.js';
import { postSessionJson } from './session-api.js';
import { SessionDialog } from './session-dialog.js';

type InstallState =
  | { step: 'options' | 'review' | 'installing' }
  | { step: 'result'; result: ResourceActionResult }
  | { step: 'error'; message: string };

const scopeLabel = { project: 'Project', user: 'User' };

export function InstallDialog({
  resource,
  selector,
  inventory,
  targets,
  token,
  onInstalled,
  onClose,
}: {
  resource: CatalogResource;
  selector: URLSearchParams;
  inventory: InventorySnapshot;
  targets: InstallationTargets;
  token: string;
  onInstalled: (inventory: InventorySnapshot) => void;
  onClose: () => void;
}) {
  const scopes = installationScopes.filter((scope) => availableInstallationDestinations(resource.kind, scope).length);
  const [scope, setScope] = useState<InstallationScope>(scopes[0]);
  const [selections, setSelections] = useState<Partial<Record<InstallationScope, InstallationDestination[]>>>({});
  const [state, setState] = useState<InstallState>({ step: 'options' });
  const defaults = selections[scope] ?? resolveInstallationDestinations(resource.kind, scope).map(({ id }) => id);
  const installed = inventory.resources.find(
    (entry) =>
      entry.managed !== false &&
      entry.scope === scope &&
      entry.kind === resource.kind &&
      entry.id === resource.id &&
      entry.catalog === resource.catalog,
  );
  const tracked = new Set(installed?.paths);
  const choices = availableInstallationDestinations(resource.kind, scope).map((layout) => {
    const path = installationPath(layout, resource.id);
    return { ...layout, path, tracked: tracked.has(path) };
  });
  const selected = choices.filter(({ id, tracked }) => !tracked && defaults.includes(id));
  const scopeError = inventory.errors.find((error) => error.scope === scope);
  const canInstall = !scopeError && selected.length > 0;
  const busy = state.step === 'installing';
  const license = resource.license_status?.toLowerCase();

  async function install() {
    if (!canInstall || state.step !== 'review') return;
    setState({ step: 'installing' });
    const query = new URLSearchParams(selector);
    query.set('scope', scope);
    for (const { id } of selected) query.append('destination', id);
    try {
      const result = await postSessionJson<ResourceActionResult>(`/api/catalog/install?${query}`, token);
      onInstalled({ resources: result.resources, errors: result.errors });
      setState({ step: 'result', result });
    } catch (error) {
      setState({
        step: 'error',
        message: error instanceof Error ? error.message : 'The installation result could not be loaded.',
      });
    }
  }

  return (
    <SessionDialog
      title={resource.id}
      subtitle="Install resource"
      closeLabel="Close installation"
      busy={busy}
      onClose={onClose}
    >
      {state.step === 'options' ? (
        <>
          <fieldset className="install-options">
            <legend>Scope</legend>
            {scopes.map((value) => (
              <label key={value}>
                <input type="radio" name="install-scope" checked={value === scope} onChange={() => setScope(value)} />
                {scopeLabel[value]}
              </label>
            ))}
          </fieldset>
          <p className="target">
            Target: <code>{targets[scope]}</code>
          </p>
          {scopeError ? <p role="alert">{scopeError.message}</p> : null}
          <fieldset className="install-options" disabled={Boolean(scopeError)}>
            <legend>Destinations</legend>
            {choices.map(({ id, label, path, tracked }) => (
              <label key={id}>
                <input
                  type="checkbox"
                  disabled={tracked}
                  checked={tracked || defaults.includes(id)}
                  onChange={(event) => {
                    setSelections({
                      ...selections,
                      [scope]: event.target.checked ? [...defaults, id] : defaults.filter((value) => value !== id),
                    });
                  }}
                />
                <span>
                  {label}
                  {tracked ? ' · Already installed' : ''}
                  <br />
                  <code>{path}</code>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="button" disabled={!canInstall} onClick={() => setState({ step: 'review' })}>
            Review installation
          </button>
        </>
      ) : state.step === 'result' ? (
        <InstallResult result={state.result} />
      ) : state.step === 'error' ? (
        <p role="alert">{state.message} Check Inventory before trying again.</p>
      ) : (
        <>
          <p>
            Revision: <code>{selector.get('ref')}</code>
          </p>
          <p>
            Files will be installed in <strong>{scopeLabel[scope]}</strong> at <code>{targets[scope]}</code>:
          </p>
          <ul>
            {selected.map(({ id, path }) => (
              <li key={id}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
          {resource.kind === 'skill' ? (
            <p>GitHub CLI also installs supporting files in the selected skill folders.</p>
          ) : null}
          {!license || license === 'not-declared' || license === 'proprietary' ? (
            <p role="note">
              {license === 'proprietary' ? 'Proprietary resource.' : 'No license declared.'} Confirm you have permission
              to use it.
            </p>
          ) : null}
          {busy ? (
            <p role="status">Installing and auditing the pinned resource…</p>
          ) : (
            <div className="resource-actions">
              <button type="button" onClick={() => setState({ step: 'options' })}>
                Back
              </button>
              <button type="button" disabled={!canInstall} onClick={() => void install()}>
                Confirm installation
              </button>
            </div>
          )}
        </>
      )}
    </SessionDialog>
  );
}

function InstallResult({ result }: { result: ResourceActionResult }) {
  const audit = result.messages.find((message) => typeof message !== 'string');
  const messages = result.messages.filter((message) => typeof message === 'string');
  const scanErrors = result.errors.filter(({ scope }) => scope !== 'catalog');
  return (
    <>
      {result.code === 0 ? (
        <p role="status">Installation complete.{scanErrors.length ? '' : ' Inventory refreshed.'}</p>
      ) : (
        <p role="alert">{result.failure?.userMessage ?? 'Installation did not complete.'}</p>
      )}
      {scanErrors.length ? (
        <ul aria-label="Inventory scan errors">
          {scanErrors.map(({ scope, message }) => (
            <li key={scope}>
              {scope}: {message}
            </li>
          ))}
        </ul>
      ) : null}
      {messages.length ? (
        <ul>
          {messages.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      ) : null}
      {result.failure?.paths?.length ? (
        <ul>
          {result.failure.paths.map((path) => (
            <li key={path}>
              <code>{path}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {audit ? (
        <section>
          <h3>Entry-file audit</h3>
          <p>
            {audit.coverage.analyzed} of {audit.coverage.discovered} files analyzed. This is not a safety guarantee.
          </p>
          {audit.findings.length ? (
            <ul>
              {audit.findings.map(({ path, line, code, message }, index) => (
                <li key={index}>
                  <code>
                    {path}:{line}
                  </code>{' '}
                  · {code}: {message}
                </li>
              ))}
            </ul>
          ) : null}
          {audit.coverage.skipped.length ? (
            <ul>
              {audit.coverage.skipped.map(({ path, reason }) => (
                <li key={path}>
                  <code>{path}</code>: {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
