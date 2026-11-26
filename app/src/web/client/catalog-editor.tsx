import { useState } from 'react';

import {
  isReservedCatalogName,
  validateSourceConfiguration,
  type CatalogEntry,
  type UserCatalog,
} from '../../core/catalogs/model.js';
import { CATALOG_PRESETS } from '../../core/catalogs/presets.js';
import type { CatalogCommand } from '../catalog-contract.js';

type SubmitCatalog = (command: CatalogCommand) => void;

export function CatalogEditor({
  catalog,
  busy,
  onSubmit,
}: {
  catalog?: UserCatalog;
  busy: boolean;
  onSubmit: SubmitCatalog;
}) {
  const [name, setName] = useState(catalog?.name ?? '');
  const [repository, setRepository] = useState(catalog?.repository ?? '');
  const [mode, setMode] = useState(catalog?.mode ?? 'basic');
  const [entries, setEntries] = useState<CatalogEntry[]>(catalog?.entries ?? []);
  const [error, setError] = useState<string>();

  function submit() {
    try {
      const [definition] = validateSourceConfiguration({
        catalog_version: 1,
        sources: [
          {
            name: name.trim(),
            repository: repository.trim(),
            mode,
            entries:
              mode === 'custom'
                ? entries.map(({ kind, id, path }) => ({
                    kind,
                    ...(id?.trim() ? { id: id.trim() } : {}),
                    path: path.trim(),
                  }))
                : [],
          },
        ],
      });
      if (isReservedCatalogName(definition.name)) throw new Error('Choose a name other than catalogSources.');
      const { repositoryId, ...request } = definition;
      setError(undefined);
      onSubmit(
        catalog
          ? { action: 'edit', originalName: catalog.name, catalog: request }
          : { action: 'add', catalog: request },
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Invalid catalog definition.');
    }
  }

  function changeEntry(index: number, change: Partial<CatalogEntry>) {
    setEntries((previous) => previous.map((entry, position) => (position === index ? { ...entry, ...change } : entry)));
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset className="catalog-form" disabled={busy}>
        <legend>Source definition</legend>
        {!catalog ? (
          <label>
            Preset
            <select
              defaultValue=""
              onChange={(event) => {
                const preset = CATALOG_PRESETS.find(({ command }) => command === event.target.value);
                setName(preset?.catalogName ?? '');
                setRepository(preset?.repository ?? '');
                setMode(preset?.mode ?? 'basic');
                setEntries(preset?.entries ?? []);
              }}
            >
              <option value="">Enter a repository manually</option>
              {CATALOG_PRESETS.map(({ command, name }) => (
                <option key={command} value={command}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Catalog name
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          GitHub repository URL
          <input
            required
            type="url"
            placeholder="https://github.com/owner/repository"
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
          />
        </label>
        <label>
          Discovery mode
          <select value={mode} onChange={(event) => setMode(event.target.value === 'custom' ? 'custom' : 'basic')}>
            <option value="basic">Basic</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {mode === 'basic' ? (
          <p>Use the repository’s standard skill, agent, and instruction locations.</p>
        ) : (
          <>
            <p>Map the repository-relative directories or Markdown files to index.</p>
            {entries.map((entry, index) => (
              <fieldset className="catalog-form" key={index}>
                <legend>Mapping {index + 1}</legend>
                <label>
                  Kind
                  <select
                    value={entry.kind}
                    onChange={(event) => changeEntry(index, { kind: event.target.value as CatalogEntry['kind'] })}
                  >
                    <option value="skill">Skill</option>
                    <option value="agent">Agent</option>
                    <option value="instruction">Instruction</option>
                  </select>
                </label>
                <label>
                  Repository path
                  <input
                    required
                    value={entry.path}
                    onChange={(event) => changeEntry(index, { path: event.target.value })}
                  />
                </label>
                <label>
                  Resource ID (optional)
                  <input value={entry.id ?? ''} onChange={(event) => changeEntry(index, { id: event.target.value })} />
                </label>
                <button
                  type="button"
                  aria-label={`Remove mapping ${index + 1}`}
                  onClick={() => setEntries(entries.filter((_, position) => position !== index))}
                >
                  Remove mapping
                </button>
              </fieldset>
            ))}
            <button type="button" onClick={() => setEntries([...entries, { kind: 'skill', path: '' }])}>
              Add mapping
            </button>
          </>
        )}
        <button type="submit" disabled={mode === 'custom' && !entries.length}>
          {catalog ? 'Save catalog' : 'Add and index catalog'}
        </button>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
