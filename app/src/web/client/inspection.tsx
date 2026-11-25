import { useEffect, useRef, useState } from 'react';

import type { ResourceInspection } from '../../core/inspection/model.js';
import type { InstallationScope } from '../../core/installations/model.js';
import type { CatalogResource } from '../../core/resources/model.js';
import { readSessionJson } from './session-api.js';

type TreeNode = { name: string; path: string; file: boolean; children: Map<string, TreeNode> };

function buildTree(inspection: ResourceInspection): Map<string, TreeNode> {
  const root = new Map<string, TreeNode>();
  for (const { path, type } of inspection.treeEntries) {
    const parts = path.split('/');
    let branch = root;
    let prefix = '';
    for (const [index, name] of parts.entries()) {
      prefix += prefix ? `/${name}` : name;
      let node = branch.get(name);
      if (!node) {
        node = { name, path: prefix, file: type === 'file' && index === parts.length - 1, children: new Map() };
        branch.set(name, node);
      }
      branch = node.children;
    }
  }
  return root;
}

function SourceTree({
  nodes,
  selected,
  onSelect,
}: {
  nodes: Map<string, TreeNode>;
  selected: string | undefined;
  onSelect: (path: string) => void;
}) {
  return (
    <ul className="source-tree">
      {[...nodes.values()].map(({ name, path, file, children }) => (
        <li key={path}>
          {file ? (
            <button type="button" aria-pressed={selected === path} onClick={() => onSelect(path)}>
              {name}
            </button>
          ) : (
            <details open>
              <summary>{name}/</summary>
              <SourceTree nodes={children} selected={selected} onSelect={onSelect} />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export function InstalledInspection({
  scope,
  resource,
  token,
  onClose,
}: {
  scope: InstallationScope;
  resource: CatalogResource;
  token: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<{ inspection: ResourceInspection; tree: Map<string, TreeNode> }>();
  const [file, setFile] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      scope,
      kind: resource.kind,
      id: resource.id,
      catalog: resource.catalog || '',
      managed: String(resource.managed !== false),
    });
    void readSessionJson<ResourceInspection>(`/api/inventory/preview?${query}`, token, controller.signal).then(
      (inspection) => setResult({ inspection, tree: buildTree(inspection) }),
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not inspect the installed resource.');
      },
    );
    return () => controller.abort();
  }, [resource, scope, token]);
  const inspection = result?.inspection;
  const selected = inspection?.files.find(({ path }) => path === file) ?? inspection?.files[0];
  const audit = inspection?.audit;
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="inspection-heading">
      <header className="inspection-header">
        <div>
          <p className="eyebrow">Installed source · {scope}</p>
          <h2 id="inspection-heading">{resource.id}</h2>
        </div>
        <button type="button" autoFocus onClick={() => dialog.current?.close()}>
          Close preview
        </button>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !result || !audit ? (
        <p role="status">Reading installed files…</p>
      ) : (
        <div className="inspection-layout">
          <section className="panel source-file" aria-labelledby="source-heading">
            <h3 id="source-heading">Source</h3>
            {selected ? (
              <>
                <p>
                  <code>{selected.path}</code>
                </p>
                <pre>
                  <code>{selected.content}</code>
                </pre>
              </>
            ) : (
              <p>No previewable files.</p>
            )}
          </section>
          <div className="inspection-sidebar">
            <section className="panel" aria-labelledby="tree-heading">
              <h3 id="tree-heading">Source tree</h3>
              <SourceTree nodes={result.tree} selected={selected?.path} onSelect={setFile} />
            </section>
            <section className="panel" aria-labelledby="audit-heading">
              <h3 id="audit-heading">Audit report</h3>
              <p>
                {audit.coverage.analyzed} of {audit.coverage.discovered} files analyzed.{' '}
                {audit.coverage.complete ? 'No files skipped.' : 'Coverage incomplete.'}
              </p>
              {!audit.findings.length && audit.coverage.analyzed > 0 ? <p>No configured audit rules matched.</p> : null}
              <p>This is not a safety guarantee.</p>
              {audit.findings.length ? (
                <ul>
                  {audit.findings.map(({ code, path, line, message }, index) => (
                    <li key={`${path}:${line}:${code}:${index}`}>
                      <code>
                        {path}:{line}
                      </code>{' '}
                      · <strong>{code}</strong>: {message}
                    </li>
                  ))}
                </ul>
              ) : null}
              {audit.coverage.skipped.length ? (
                <>
                  <h4>Skipped files</h4>
                  <ul>
                    {audit.coverage.skipped.map(({ path, reason }) => (
                      <li key={path}>
                        <code>{path}</code>: {reason}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </dialog>
  );
}
