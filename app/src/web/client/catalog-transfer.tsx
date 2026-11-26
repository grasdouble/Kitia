import { useEffect, useState } from 'react';

import type { CatalogConfigurationDocument } from '../../core/catalogs/manage.js';
import { isReservedCatalogName, validateSourceConfiguration, type UserCatalog } from '../../core/catalogs/model.js';
import { CATALOG_BODY_LIMIT, type CatalogCommand } from '../catalog-contract.js';
import { readSessionJson } from './session-api.js';

export function CatalogImport({ busy, onSubmit }: { busy: boolean; onSubmit: (command: CatalogCommand) => void }) {
  const [text, setText] = useState('');
  const [review, setReview] = useState<UserCatalog[]>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string>();

  function preview() {
    try {
      if (new TextEncoder().encode(text).byteLength > CATALOG_BODY_LIMIT)
        throw new Error('Catalog files are limited to 1 MiB.');
      const manifest = JSON.parse(text);
      if (manifest?.catalog_version !== 1 || !Array.isArray(manifest.sources) || !manifest.sources.length) {
        throw new Error('Provide a version 1 catalog configuration with at least one source.');
      }
      const sources = manifest.sources.map((source: unknown) => {
        const [{ repositoryId, ...definition }] = validateSourceConfiguration({
          catalog_version: 1,
          sources: [source],
        });
        if (isReservedCatalogName(definition.name)) throw new Error('The catalogSources registry name is reserved.');
        return definition;
      });
      setSelected(new Set(sources.map((_: UserCatalog, index: number) => index)));
      setReview(sources);
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Invalid catalog configuration.');
    }
  }

  async function load(file?: File) {
    if (!file) return;
    try {
      if (file.size > CATALOG_BODY_LIMIT) throw new Error('Catalog files are limited to 1 MiB.');
      setText(await file.text());
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read the selected file.');
    }
  }

  return (
    <>
      {review ? (
        <fieldset className="catalog-form" disabled={busy}>
          <legend>Catalogs to import</legend>
          <p>Existing names and repositories are skipped. New catalogs are refreshed after import.</p>
          {review.map(({ name, repository, mode }, index) => (
            <label className="catalog-choice" key={index}>
              <input
                type="checkbox"
                checked={selected.has(index)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (checked) next.add(index);
                    else next.delete(index);
                    return next;
                  });
                }}
              />
              <span>
                {name} · {mode ?? 'basic'} · <code>{repository}</code>
              </span>
            </label>
          ))}
          <div className="resource-actions">
            <button type="button" onClick={() => setReview(undefined)}>
              Back
            </button>
            <button
              type="button"
              disabled={!selected.size}
              onClick={() => onSubmit({ action: 'import', sources: review.filter((_, index) => selected.has(index)) })}
            >
              Import selected catalogs
            </button>
          </div>
        </fieldset>
      ) : (
        <fieldset className="catalog-form">
          <legend>Catalog configuration</legend>
          <label>
            JSON file
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => void load(event.target.files?.[0])}
            />
          </label>
          <label>
            Catalog JSON
            <textarea rows={8} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <button type="button" disabled={!text.trim()} onClick={preview}>
            Review import
          </button>
        </fieldset>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

export function CatalogExport({ token }: { token: string }) {
  const [data, setData] = useState<{ text: string; href: string }>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void readSessionJson<CatalogConfigurationDocument>('/api/catalog/export', token, controller.signal).then(
      (configuration) => {
        if (controller.signal.aborted) return;
        const text = `${JSON.stringify(configuration, null, 2)}\n`;
        url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        setData({ text, href: url });
      },
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not export catalogs.');
      },
    );
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [token]);

  async function copy(text: string) {
    setCopied(false);
    setError(undefined);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError('Clipboard unavailable. Download the file or copy the text manually.');
    }
  }

  return (
    <>
      {data ? (
        <div className="catalog-form">
          <div className="resource-actions">
            <a href={data.href} download="catalogSources.json">
              Download catalogSources.json
            </a>
            <button type="button" onClick={() => void copy(data.text)}>
              Copy JSON
            </button>
          </div>
          <label>
            Exported catalog JSON
            <textarea readOnly rows={8} value={data.text} />
          </label>
        </div>
      ) : !error ? (
        <p role="status">Loading catalog configuration…</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {copied ? <p role="status">Catalog JSON copied.</p> : null}
    </>
  );
}
