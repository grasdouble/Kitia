import { useEffect, useState } from 'react';

import type {
  InventoryMutation,
  InventoryMutationRetry,
  InventoryMutationReview,
} from '../../application/inventory-mutation.js';
import type { InstalledResourceSelector } from '../../application/inventory-preview.js';
import type { ResourceActionResult } from '../../application/resource-actions.js';
import type { InventorySnapshot } from '../../application/snapshot.js';
import { MutationResult } from './mutation-result.js';
import { RevisionHistory } from './revision-history.js';
import { postSessionJson, readSessionJson, runSessionMutation } from './session-api.js';
import { SessionDialog } from './session-dialog.js';

const copy = {
  update: { label: 'Update', result: 'Update', description: 'Update the tracked installation at:' },
  uninstall: { label: 'Uninstall', result: 'Uninstall', description: 'Remove the tracked files from:' },
  'remove-unmanaged': {
    label: 'Remove unmanaged files',
    result: 'Removal',
    description: 'Permanently remove these unmanaged paths from:',
  },
};

type Response = ResourceActionResult & { retry?: InventoryMutationRetry };
type State =
  | { step: 'loading' }
  | { step: 'running'; progress?: string }
  | { step: 'review'; review: InventoryMutationReview; confirmation?: string }
  | { step: 'result'; result: Response }
  | { step: 'error'; message: string };

export function InventoryActionDialog({
  action,
  selector,
  initialRevision,
  target,
  token,
  onChanged,
  onClose,
}: {
  action: InventoryMutation;
  selector: InstalledResourceSelector;
  initialRevision?: string;
  target: string;
  token: string;
  onChanged: (inventory: InventorySnapshot) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ step: 'loading' });
  const [revision, setRevision] = useState(initialRevision);
  const [choosing, setChoosing] = useState(false);
  const selectorParams = { catalog: selector.catalog, kind: selector.kind, id: selector.id };
  const query = new URLSearchParams({
    ...selectorParams,
    scope: selector.scope,
    managed: String(selector.managed),
    action,
  });
  if (revision) query.set('revision', revision);
  const endpoint = `/api/inventory/action?${query}`;

  function chooseRevision(next?: string) {
    setChoosing(false);
    if (next !== revision) {
      setState({ step: 'loading' });
      setRevision(next);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void readSessionJson<InventoryMutationReview>(endpoint, token, controller.signal).then(
      (review) => setState({ step: 'review', review }),
      (error: unknown) => {
        if (!controller.signal.aborted) failed(error);
      },
    );
    return () => controller.abort();
  }, [endpoint, token]);

  function failed(error: unknown) {
    setState({
      step: 'error',
      message: error instanceof Error ? error.message : 'The request could not be completed.',
    });
  }

  async function prepareRemoval(review: InventoryMutationReview) {
    setState({ step: 'running' });
    try {
      const query = new URLSearchParams({ stamp: review.stamp });
      const { confirmation } = await postSessionJson<{ confirmation: string }>(`${endpoint}&${query}`, token);
      setState({ step: 'review', review, confirmation });
    } catch (error) {
      failed(error);
    }
  }

  async function confirm(stamp: string, authorization?: { retry: string } | { confirmation: string }) {
    setState({ step: 'running' });
    try {
      const query = new URLSearchParams({ stamp, ...authorization });
      const result = await runSessionMutation<Response>(`${endpoint}&${query}`, token, (progress) =>
        setState({ step: 'running', progress }),
      );
      onChanged({ resources: result.resources, errors: result.errors });
      setState({ step: 'result', result });
    } catch (error) {
      failed(error);
    }
  }

  const message = copy[action];
  const retry = state.step === 'result' ? state.result.retry : undefined;
  const removalConfirmation = state.step === 'review' && state.confirmation;
  return (
    <SessionDialog
      title={selector.id}
      subtitle={message.label}
      closeLabel="Close action"
      busy={state.step === 'running'}
      onClose={onClose}
    >
      {state.step === 'review' ? (
        <>
          <p className="target">
            {message.description} <strong>{selector.scope === 'project' ? 'Project' : 'User'}</strong> ·{' '}
            <code>{target}</code>
          </p>
          {state.review.ref ? (
            <p>
              {revision ? 'Selected revision: ' : 'Catalog revision: '}
              <code>{state.review.ref}</code>
            </p>
          ) : null}
          {state.review.catalogPin ? (
            <div className="resource-actions">
              <button type="button" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>
                Choose revision
              </button>
              {revision ? (
                <button type="button" onClick={() => chooseRevision()}>
                  Use catalog pin
                </button>
              ) : null}
            </div>
          ) : null}
          {choosing && state.review.catalogPin ? (
            <RevisionHistory
              endpoint={`/api/catalog/revisions?${new URLSearchParams({ ...selectorParams, ref: state.review.catalogPin })}`}
              catalogPin={state.review.catalogPin}
              token={token}
              onSelect={chooseRevision}
            />
          ) : null}
          <ul>
            {state.review.paths.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
          {action === 'remove-unmanaged' && selector.kind === 'skill' ? (
            <p>Each listed skill folder and all of its contents will be deleted.</p>
          ) : null}
          {removalConfirmation ? (
            <>
              <p role="alert">This cannot be undone. Kitia does not keep a copy of these files.</p>
              <button
                type="button"
                onClick={() => void confirm(state.review.stamp, { confirmation: removalConfirmation })}
              >
                Permanently remove files
              </button>
            </>
          ) : action === 'remove-unmanaged' ? (
            <button type="button" onClick={() => void prepareRemoval(state.review)}>
              Continue to removal confirmation
            </button>
          ) : (
            <button type="button" disabled={choosing} onClick={() => void confirm(state.review.stamp)}>
              Confirm {message.label.toLowerCase()}
            </button>
          )}
        </>
      ) : state.step === 'result' ? (
        <>
          <MutationResult result={state.result} operation={message.result} />
          {retry ? (
            <>
              {retry.kind === 'local' ? (
                <p>Retrying can replace the local files listed above. Back them up to keep your changes.</p>
              ) : (
                <p>
                  GitHub CLI requested permission to replace the existing {state.result.failure?.agent} copy. This
                  confirmation is for that destination only.
                </p>
              )}
              <button type="button" onClick={() => void confirm(retry.review.stamp, { retry: retry.ticket })}>
                Confirm overwrite and retry
              </button>
            </>
          ) : null}
        </>
      ) : state.step === 'error' ? (
        <p role="alert">{state.message}</p>
      ) : (
        <p role="status">
          {state.step === 'running'
            ? (state.progress ?? 'Working on the selected resource…')
            : 'Reviewing the selected paths…'}
        </p>
      )}
    </SessionDialog>
  );
}
