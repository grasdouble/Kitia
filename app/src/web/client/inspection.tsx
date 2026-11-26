import { useEffect, useState } from 'react';

import type { SourceInspection } from '../../application/catalog-preview.js';
import type { ResourceInspection } from '../../core/inspection/model.js';
import { readSessionJson } from './session-api.js';
import { SessionDialog } from './session-dialog.js';
import { SourceCode } from './source-code.js';

type Inspection = ResourceInspection | SourceInspection;

type TreeNode = { name: string; path: string; file: boolean; children: Map<string, TreeNode> };

function buildTree(inspection: Inspection): Map<string, TreeNode> {
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
  available,
  onSelect,
}: {
  nodes: Map<string, TreeNode>;
  selected: string | undefined;
  available: Set<string>;
  onSelect: (path: string) => void;
}) {
  return (
    <ul className="source-tree">
      {[...nodes.values()].map(({ name, path, file, children }) => (
        <li key={path}>
          {file ? (
            available.has(path) ? (
              <button type="button" aria-pressed={selected === path} onClick={() => onSelect(path)}>
                {name}
              </button>
            ) : (
              <span>{name} (not included in preview)</span>
            )
          ) : (
            <details open>
              <summary>{name}/</summary>
              <SourceTree nodes={children} selected={selected} available={available} onSelect={onSelect} />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export function InspectionDialog({
  title,
  subtitle,
  endpoint,
  token,
  onClose,
}: {
  title: string;
  subtitle: string;
  endpoint: string;
  token: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<{
    inspection: Inspection;
    tree: Map<string, TreeNode>;
    available: Set<string>;
  }>();
  const [file, setFile] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void readSessionJson<Inspection>(endpoint, token, controller.signal).then(
      (inspection) =>
        setResult({
          inspection,
          tree: buildTree(inspection),
          available: new Set(inspection.files.map(({ path }) => path)),
        }),
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not inspect the resource.');
      },
    );
    return () => controller.abort();
  }, [endpoint, token]);
  const inspection = result?.inspection;
  const selected = inspection?.files.find(({ path }) => path === file) ?? inspection?.files[0];
  const audit = inspection?.audit;
  return (
    <SessionDialog title={title} subtitle={subtitle} closeLabel="Close preview" onClose={onClose}>
      {error ? (
        <p role="alert">{error}</p>
      ) : !result ? (
        <p role="status">Reading source files…</p>
      ) : (
        <div className="inspection-layout">
          <section className="panel source-file" aria-labelledby="source-heading">
            <h3 id="source-heading">Source</h3>
            {selected ? (
              <>
                <p>
                  <code>{selected.path}</code>
                </p>
                <SourceCode {...selected} />
              </>
            ) : (
              <p>No previewable files.</p>
            )}
          </section>
          <div className="inspection-sidebar">
            <section className="panel" aria-labelledby="tree-heading">
              <h3 id="tree-heading">Source tree</h3>
              <SourceTree
                nodes={result.tree}
                selected={selected?.path}
                available={result.available}
                onSelect={setFile}
              />
            </section>
            <section className="panel" aria-labelledby="audit-heading">
              <h3 id="audit-heading">Audit report</h3>
              {'origin' in result.inspection ? <p>Catalog audit covers the pinned source entry file.</p> : null}
              {!audit ? (
                <p>Audit report unavailable; no result was returned.</p>
              ) : (
                <>
                  <p>
                    {audit.coverage.analyzed} of {audit.coverage.discovered} files analyzed.{' '}
                    {audit.coverage.complete ? 'No files skipped.' : 'Coverage incomplete.'}
                  </p>
                  {!audit.findings.length && audit.coverage.analyzed > 0 ? (
                    <p>No configured audit rules matched.</p>
                  ) : null}
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
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </SessionDialog>
  );
}
