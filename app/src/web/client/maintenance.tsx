import { useEffect, useState } from 'react';

import type { InstallationTargets, InventorySnapshot } from '../../application/snapshot.js';
import type { VersionStatus } from '../maintenance-contract.js';
import { postSessionJson, readSessionJson } from './session-api.js';
import { SessionDialog } from './session-dialog.js';

export const guideSteps = [
  {
    section: 'inventory',
    title: 'Inventory',
    description: 'Inspect project and user installations, preview local files, and review updates or removals.',
  },
  {
    section: 'browse',
    title: 'Browse resources',
    description: 'Search catalog resources, review their pinned source and audit, and choose where to install them.',
  },
  {
    section: 'catalogs',
    title: 'Catalogs',
    description: 'Add, import, or refresh GitHub catalogs. Refreshing an index does not change installed files.',
  },
] as const;

export function GettingStarted({
  step,
  onStep,
  onClose,
}: {
  step: number;
  onStep: (step: number) => void;
  onClose: () => void;
}) {
  const { title, description } = guideSteps[step];
  return (
    <SessionDialog
      title={title}
      subtitle={`Getting started · ${step + 1} of ${guideSteps.length}`}
      closeLabel="Close guide"
      onClose={onClose}
    >
      <p>{description}</p>
      <div className="resource-actions">
        {step > 0 ? (
          <button type="button" onClick={() => onStep(step - 1)}>
            Back
          </button>
        ) : null}
        {step + 1 === guideSteps.length ? (
          <button type="button" onClick={onClose}>
            Finish guide
          </button>
        ) : (
          <button type="button" onClick={() => onStep(step + 1)}>
            Next
          </button>
        )}
      </div>
    </SessionDialog>
  );
}

export function MigrationNotice({
  inventory,
  targets,
}: {
  inventory: InventorySnapshot;
  targets: InstallationTargets;
}) {
  const scopes = (['project', 'user'] as const).filter((scope) =>
    inventory.errors.some((error) => error.scope === scope && error.code === 'INVENTORY_MIGRATION_REQUIRED'),
  );
  if (!scopes.length) return null;
  return (
    <section className="panel maintenance-notice" role="alert" aria-labelledby="migration-heading">
      <h2 id="migration-heading">Inventory migration required</h2>
      <ul>
        {scopes.map((scope) => (
          <li key={scope}>
            {scope === 'project' ? 'Project' : 'User'}: <code>{targets[scope]}</code>
          </li>
        ))}
      </ul>
      <p>
        Stop this session with <kbd>Ctrl+C</kbd>. From the launch project directory, run:
      </p>
      <p>
        <code>npx --yes @grasdouble/kitia migrate --apply</code>
      </p>
      <p>
        The command checks both inventories and skips ones already current. Run <code>kitia web</code> again after
        migration.
      </p>
    </section>
  );
}

export function VersionMaintenance({ token, onStopped }: { token: string; onStopped: () => void }) {
  const [status, setStatus] = useState<VersionStatus>();
  const [error, setError] = useState<string>();
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void readSessionJson<VersionStatus>('/api/version', token, controller.signal).then(
      setStatus,
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not check for updates.');
      },
    );
    return () => controller.abort();
  }, [token]);

  async function update() {
    setError(undefined);
    setPending(true);
    try {
      await postSessionJson<{ accepted: true }>('/api/self-update', token);
      onStopped();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start the update.');
      setPending(false);
    }
  }

  if (status?.status !== 'update')
    return (
      <details className="maintenance-notice">
        <summary>Kitia updates</summary>
        <p>
          {status?.status === 'current'
            ? 'This is the current release.'
            : status || error
              ? 'Could not check for a new release.'
              : 'Checking for a new release…'}
        </p>
        {status?.status === 'unavailable' ? <p>{status.manualUpdate}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </details>
    );
  return (
    <section className="panel maintenance-notice" aria-labelledby="version-heading">
      <h2 id="version-heading">Kitia {status.notice.available} is available</h2>
      <p>
        <a href={status.notice.changelogUrl} target="_blank" rel="noreferrer">
          Release notes
        </a>
      </p>
      {status.manager ? (
        <button
          type="button"
          onClick={() => {
            setError(undefined);
            setReviewing(true);
          }}
        >
          Update Kitia…
        </button>
      ) : (
        <p>{status.manualUpdate}</p>
      )}
      {reviewing && status.manager ? (
        <SessionDialog
          title="Update Kitia"
          subtitle="Package maintenance"
          closeLabel="Cancel update"
          busy={pending}
          onClose={() => setReviewing(false)}
        >
          <p>
            This closes the browser session, then updates the global installation with <code>{status.manager}</code>.
          </p>
          <p>
            Follow the result in the launch terminal, then run <code>kitia web</code> again.
          </p>
          <button type="button" disabled={pending} onClick={() => void update()}>
            Confirm update and stop session
          </button>
          {pending ? <p role="status">Closing the session…</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </SessionDialog>
      ) : null}
    </section>
  );
}
