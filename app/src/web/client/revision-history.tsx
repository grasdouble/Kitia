import { useEffect, useState } from 'react';

import type { ResourceRevision } from '../../application/snapshot.js';
import { readSessionJson } from './session-api.js';

export function RevisionHistory({
  endpoint,
  catalogPin,
  token,
  onSelect,
}: {
  endpoint: string;
  catalogPin: string;
  token: string;
  onSelect: (sha: string) => void;
}) {
  const [history, setHistory] = useState<ResourceRevision[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void readSessionJson<ResourceRevision[]>(endpoint, token, controller.signal).then(
      setHistory,
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load revisions.');
      },
    );
    return () => controller.abort();
  }, [endpoint, token]);
  if (error) return <p role="alert">{error}</p>;
  if (!history) return <p role="status">Loading commit history…</p>;
  if (!history.length) return <p>No commits found for this resource path.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Commit</th>
            <th scope="col">Date</th>
            <th scope="col">Subject</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {history.map(({ sha, prefix, date, subject }) => (
            <tr key={sha}>
              <th scope="row">
                <details>
                  <summary>
                    <code>{prefix}</code>
                    {sha === catalogPin ? ' · Catalog pin' : ''}
                  </summary>
                  <code>{sha}</code>
                </details>
              </th>
              <td>
                <time dateTime={date}>{date.slice(0, 10)}</time>
              </td>
              <td>{subject}</td>
              <td>
                <button type="button" aria-label={`Use commit ${prefix}`} onClick={() => onSelect(sha)}>
                  Use revision
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
