import type { CatalogResource } from '../resources/model.js';
import type { PreviewFile, PreviewTreeEntry } from './model.js';

export function decodeSourcePreview(resource: CatalogResource, content: string) {
  const sourceParts = (resource.source_path || '').split('/').filter(Boolean);
  const sourceName = sourceParts.at(-1);
  const root =
    (resource.kind === 'skill' ? (sourceName === 'SKILL.md' ? sourceParts.at(-2) : sourceName) : undefined) ||
    resource.id;
  const fileName = resource.kind === 'skill' ? 'SKILL.md' : sourceName || `${resource.id}.md`;
  const singleFile = () => ({
    root,
    treeEntries: [{ path: fileName, type: 'file' as const }],
    files: [{ path: fileName, content }],
  });
  // Only GitHub CLI skill previews use tree and file framing. Agent and instruction
  // Markdown can contain the same markers and must be kept as a single file.
  if (resource.kind !== 'skill') return singleFile();

  const lines = content.split('\n');
  const lineAt = (index: number) => lines[index]?.replace(/\r$/, '');
  let cursor = 0;
  while (cursor < lines.length && !lineAt(cursor)?.trim()) cursor += 1;
  const treeEntry = /^((?:│   |    )*)(?:├── |└── )(.+)$/u;
  const first = lineAt(cursor);
  const hasRoot = first?.endsWith('/') && treeEntry.test(lineAt(cursor + 1) || '');
  if (hasRoot) cursor += 1;
  const directories: string[] = [];
  const paths = new Set<string>();
  const treeEntries: PreviewTreeEntry[] = [];
  while (cursor < lines.length) {
    const entry = lineAt(cursor)?.match(treeEntry);
    if (!entry) break;
    const depth = entry[1].length / 4;
    const directory = entry[2].endsWith('/');
    const name = directory ? entry[2].slice(0, -1) : entry[2];
    directories.length = depth;
    const path = [...directories, name].join('/');
    treeEntries.push({ path, type: directory ? 'directory' : 'file' });
    if (directory) directories.push(name);
    else paths.add(path);
    cursor += 1;
  }
  while (cursor < lines.length && !lineAt(cursor)?.trim()) cursor += 1;
  if (lineAt(cursor) !== '── SKILL.md ──' || lineAt(cursor + 1)?.trim() !== '') return singleFile();

  const files: PreviewFile[] = [];
  const seen = new Set(['SKILL.md']);
  let filePath = 'SKILL.md';
  let fileStart = cursor + 2;
  let fence: { character: string; length: number } | undefined;
  const appendFile = (end: number) => {
    // The spacer between frames belongs to gh, not the file. Preserve other blank lines.
    if (end > fileStart && lineAt(end - 1) === '') end -= 1;
    files.push({ path: filePath, content: lines.slice(fileStart, end).join('\n').replace(/\r$/, '') });
  };
  for (cursor = fileStart; cursor < lines.length; cursor += 1) {
    const line = lineAt(cursor)!;
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (fence.character === marker[1][0] && marker[1].length >= fence.length && !marker[2].trim())
        fence = undefined;
      continue;
    }
    const header = !fence && line.match(/^── (.+) ──$/u);
    if (header && paths.has(header[1]) && !seen.has(header[1]) && lineAt(cursor + 1)?.trim() === '') {
      appendFile(cursor);
      filePath = header[1];
      seen.add(filePath);
      cursor += 1;
      fileStart = cursor + 1;
    }
  }
  appendFile(lines.length);
  return {
    root: hasRoot ? first!.slice(0, -1) : root,
    treeEntries: treeEntries.length ? treeEntries : [{ path: 'SKILL.md', type: 'file' as const }],
    files,
  };
}
