import type { PreviewTreeEntry } from '../core/inspection/model.js';

export function formatPreviewTree(root: string, entries: PreviewTreeEntry[]): string[] {
  const lastByParent = new Map<string, string>();
  for (const { path } of entries) lastByParent.set(path.slice(0, Math.max(0, path.lastIndexOf('/'))), path);
  const indentByParent = new Map([['', '']]);
  return [
    `${root}/`,
    ...entries.map(({ path, type }) => {
      const divider = path.lastIndexOf('/');
      const parent = path.slice(0, Math.max(0, divider));
      const indent = indentByParent.get(parent) ?? '';
      const last = lastByParent.get(parent) === path;
      if (type === 'directory') indentByParent.set(path, `${indent}${last ? '    ' : '│   '}`);
      // Local inventories list full relative paths without synthetic directories.
      const name = indentByParent.has(parent) ? path.slice(divider + 1) : path;
      return `${indent}${last ? '└──' : '├──'} ${name}${type === 'directory' ? '/' : ''}`;
    }),
  ];
}
