"use strict";

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import { DASHBOARD_THEME } from "../colors.js";
import { fitText, wrapText } from "../helpers.mjs";
import { DASHBOARD_HEADER_ROWS, DashboardHeader, Panel, PanelHeader } from "./shared.mjs";
import { highlightSource, type SyntaxLine } from "../source-highlighting.mjs";

const h = React.createElement;
export type InspectionFocus = "source" | "audit" | "tree";
type InspectionScreenState = {
  resource: CatalogResource;
  content: string;
  page: number;
  focus?: InspectionFocus;
  auditPage?: number;
  treePage?: number;
};

const inspectionShortcuts = "S source · A audit · T tree · TAB panel · ←/→ PGUP/PGDN page · ENTER/ESC close";

type InspectionPage = { title: string; lines: string[]; syntax?: SyntaxLine[] };

function fallbackPreviewTree(resource: CatalogResource, filePath: string) {
  const sourceParts = (resource.source_path || "").split("/").filter(Boolean);
  const root = resource.kind === "skill"
    ? sourceParts.at(-1) === "SKILL.md" ? sourceParts.at(-2) : sourceParts.at(-1)
    : resource.id;
  return [`${root || resource.id}/`, `└── ${filePath}`];
}

function parsePreviewFiles(resource: CatalogResource, content: string) {
  const lines = content.split(/\r?\n/);
  const singleFile = () => {
    const sourcePath = (resource.source_path || "").split("/").filter(Boolean).at(-1);
    const filePath = resource.kind === "skill" ? "SKILL.md" : sourcePath || `${resource.id}.md`;
    return {
      treeLines: fallbackPreviewTree(resource, filePath),
      files: [{ path: filePath, lines: content.trim() ? lines : ["Source content unavailable; no preview was returned."] }],
    };
  };
  // Agents and instructions are raw Markdown, not gh's framed skill preview.
  if (resource.kind !== "skill") return singleFile();

  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  const treeStart = cursor;
  const treeEntry = /^((?:│   |    )*)(?:├── |└── )(.+)$/u;
  if (lines[cursor]?.endsWith("/") && treeEntry.test(lines[cursor + 1] || "")) cursor += 1;
  const directories: string[] = [];
  const paths = new Set<string>();
  while (cursor < lines.length) {
    const entry = lines[cursor].match(treeEntry);
    if (!entry) break;
    const depth = entry[1].length / 4;
    const name = entry[2];
    directories.length = depth;
    if (name.endsWith("/")) directories.push(name.slice(0, -1));
    else paths.add([...directories, name].join("/"));
    cursor += 1;
  }
  const treeLines = lines.slice(treeStart, cursor);
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  // gh emits precisely "── <path> ──", a blank line, then the file body.
  // Do not infer framing from Markdown rules, table separators, or body prose.
  if (lines[cursor] !== "── SKILL.md ──" || lines[cursor + 1]?.trim() !== "") return singleFile();

  const files: Array<{ path: string; lines: string[] }> = [];
  const seen = new Set(["SKILL.md"]);
  let filePath = "SKILL.md";
  let fileLines: string[] = [];
  let fence: { character: string; length: number } | undefined;
  cursor += 2;
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character &&
          marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      fileLines.push(line);
      continue;
    }
    const header = !fence && line.match(/^── (.+) ──$/u);
    if (header && paths.has(header[1]) && !seen.has(header[1]) && lines[cursor + 1]?.trim() === "") {
      // Remove just gh's inter-file spacer; retain blank lines from the body.
      if (fileLines.at(-1) === "") fileLines.pop();
      files.push({ path: filePath, lines: fileLines.length ? fileLines : ["(empty file)"] });
      filePath = header[1];
      seen.add(filePath);
      fileLines = [];
      cursor += 1;
    } else {
      fileLines.push(line);
    }
  }
  // A final newline terminates the last line; it is not an extra blank row.
  if (fileLines.at(-1) === "") fileLines.pop();
  files.push({ path: filePath, lines: fileLines.length ? fileLines : ["(empty file)"] });
  return {
    treeLines: treeLines.length ? treeLines : fallbackPreviewTree(resource, "SKILL.md"),
    files,
  };
}

function chunkInspectionLines(title: string, lines: string[], pageSize: number, syntax?: SyntaxLine[]): InspectionPage[] {
  const chunks = [];
  for (let offset = 0; offset < lines.length; offset += pageSize) {
    chunks.push(lines.slice(offset, offset + pageSize));
  }
  if (!chunks.length) chunks.push([""]);
  return chunks.map((chunk, index) => ({
    title: chunks.length > 1 ? `${title} · PART ${index + 1}/${chunks.length}` : title,
    lines: chunk,
    ...(syntax ? { syntax: syntax.slice(index * pageSize, (index + 1) * pageSize) } : {}),
  }));
}

function wrapSourceLine(line: string, width: number): string[] {
  // Source indentation and table spacing are content, not prose whitespace.
  if (line.length <= width) return [line];
  const characters = Array.from(line);
  const lines = [];
  for (let offset = 0; offset < characters.length; offset += width) {
    lines.push(characters.slice(offset, offset + width).join(""));
  }
  return lines;
}

type InspectionOptions = Pick<InspectionScreenState, "resource" | "content" | "focus"> & {
  columns: number;
  rows: number;
};

type InspectionFile = { path: string; lines: string[]; syntax?: SyntaxLine[] };
type InspectionContent = { auditLines: string[]; treeLines: string[]; files: InspectionFile[] };

function inspectionContent(resource: CatalogResource, content: string, highlight = false): InspectionContent {
  const lines = content.split(/\r?\n/);
  const auditStart = lines.findIndex((line) => line.startsWith("Audit coverage:"));
  const auditLines: string[] = [];
  let previewContent = content;
  if (auditStart >= 0) {
    let previewStart = auditStart;
    while (previewStart < lines.length && (
      previewStart === auditStart || lines[previewStart].startsWith("  ")
    )) {
      auditLines.push(lines[previewStart]);
      previewStart += 1;
    }
    previewContent = [...lines.slice(0, auditStart), ...lines.slice(previewStart)].join("\n");
  }
  if (!auditLines.length) auditLines.push("Audit report unavailable; no result was returned.");
  const { treeLines, files } = parsePreviewFiles(resource, previewContent);
  return {
    auditLines, treeLines,
    files: highlight ? files.map((file) => ({ ...file, syntax: highlightSource(file.path, file.lines) })) : files,
  };
}

function wrapInspectionFile(file: InspectionFile, width: number) {
  const lines: string[] = [];
  const syntax: SyntaxLine[] | undefined = file.syntax ? [] : undefined;
  for (let index = 0; index < file.lines.length; index += 1) {
    const rows = wrapSourceLine(file.lines[index], width);
    for (const row of rows) lines.push(row);
    if (!syntax) continue;
    const spans = file.syntax![index];
    if (rows.length === 1) {
      syntax.push(spans);
      continue;
    }
    let spanIndex = 0;
    let offset = 0;
    for (const row of rows) {
      const parts: SyntaxLine = [];
      let remaining = row.length;
      while (remaining > 0 && spanIndex < spans.length) {
        const span = spans[spanIndex];
        const length = Math.min(remaining, span.text.length - offset);
        parts.push(offset === 0 && length === span.text.length
          ? span
          : { ...span, text: span.text.slice(offset, offset + length) });
        remaining -= length;
        offset += length;
        if (offset === span.text.length) {
          spanIndex += 1;
          offset = 0;
        }
      }
      syntax.push(parts);
    }
  }
  return { lines, syntax };
}

function inspectionLayout(
  { resource, content, columns, rows }: InspectionOptions,
  model = inspectionContent(resource, content),
) {
  const width = Math.max(1, columns - 2);
  const compact = rows < 18;
  const headerRows = compact ? 1 : DASHBOARD_HEADER_ROWS;
  const shortcuts = wrapText(inspectionShortcuts, width);
  // Reserve body space even on very short terminals. S/A/T always remain usable.
  const footer = shortcuts.slice(0, Math.max(0, rows - headerRows - 5));
  const bodyRows = Math.max(4, rows - headerRows - footer.length - 1);
  const split = columns >= 100 && bodyRows >= 12;
  const sidebarWidth = split ? Math.min(48, Math.floor(width * 0.38)) : width;
  const sourceWidth = split ? width - sidebarWidth - 1 : width;
  const auditRows = split ? Math.min(Math.ceil((bodyRows - 1) * 0.6), bodyRows - 6) : bodyRows;
  const treeRows = split ? bodyRows - auditRows - 1 : bodyRows;
  const sourceBorder = bodyRows >= 6;
  // Title, filename and divider form a header; none consume source-body rows.
  const sourceBodyRows = Math.max(1, bodyRows - (sourceBorder ? 2 : 0) - 3);
  const auditBorder = auditRows >= 5;
  const treeBorder = treeRows >= 5;
  const auditBodyRows = Math.max(1, auditRows - (auditBorder ? 2 : 0) - 2);
  const treeBodyRows = Math.max(1, treeRows - (treeBorder ? 2 : 0) - 2);
  const sourceContentWidth = Math.max(1, sourceWidth - 4);
  const sidebarContentWidth = Math.max(1, sidebarWidth - 4);
  const { auditLines, treeLines, files } = model;
  const panels = {
    source: files.flatMap((file) => {
      const wrapped = wrapInspectionFile(file, sourceContentWidth);
      return chunkInspectionLines(`FILE ${file.path}`, wrapped.lines, sourceBodyRows, wrapped.syntax);
    }),
    audit: chunkInspectionLines(
      "AUDIT REPORT",
      auditLines.flatMap((line) => wrapText(line, sidebarContentWidth)),
      auditBodyRows,
    ),
    tree: chunkInspectionLines(
      "SOURCE TREE",
      treeLines.flatMap((line) => wrapSourceLine(line, sidebarContentWidth)),
      treeBodyRows,
    ),
  };
  return {
    metadata: `${resource.catalog || "source"} / ${resource.kind}:${resource.id}`,
    compact, footer, bodyRows, split, sourceWidth, sidebarWidth,
    sourceBorder, auditBorder, treeBorder, sourceBodyRows, auditBodyRows, treeBodyRows, panels,
  };
}

export function inspectionPageCount(options: InspectionOptions) {
  return inspectionLayout(options).panels[options.focus || "source"].length;
}

export function inspectionPageView(options: InspectionOptions & { page: number }) {
  const pages = inspectionLayout(options).panels[options.focus || "source"];
  const page = Math.max(0, Math.min(pages.length - 1, options.page));
  return { ...pages[page], page, pageCount: pages.length };
}

export function InspectionScreen({
  resource, content, page, auditPage = 0, treePage = 0, focus = "source",
  versionLabel, columns, rows,
}: InspectionScreenState & { versionLabel: string; columns: number; rows: number }) {
  const model = useMemo(() => inspectionContent(resource, content, true), [resource, content]);
  const layout = useMemo(
    () => inspectionLayout({ resource, content, columns, rows }, model),
    [resource, content, columns, rows, model],
  );
  const panel = (name: InspectionFocus, selectedPage: number, width: number, bodyRows: number) => {
    const pages = layout.panels[name];
    const currentPage = Math.max(0, Math.min(pages.length - 1, selectedPage));
    const current = pages[currentPage];
    const contentWidth = Math.max(1, width - 4);
    const label = name === "source" ? "SOURCE" : name === "audit" ? "AUDIT REPORT" : "SOURCE TREE";
    const pageLabel = `PAGE ${currentPage + 1}/${pages.length}`;
    const title = contentWidth < 28 ? `${pageLabel} · ${label}` : `${label} · ${pageLabel}`;
    const color = focus === name ? DASHBOARD_THEME.semantic.selected : DASHBOARD_THEME.semantic.accents.muted;
    if (name === "source") {
      return h(Box, {
        flexDirection: "column", width, flexShrink: 0,
        borderStyle: layout.sourceBorder ? "single" : undefined,
        borderColor: color,
        paddingX: layout.sourceBorder ? 1 : 2,
      },
      h(PanelHeader, {
        title: fitText(`${focus === name ? "› " : ""}${title}`, contentWidth), color,
      },
      h(Text, { color: DASHBOARD_THEME.semantic.accents.label, wrap: "truncate-end" },
        fitText(current.title, contentWidth))),
      ...Array.from({ length: bodyRows }, (_, index) =>
        h(Text, { key: `source-${currentPage}-${index}`, wrap: "truncate-end" },
          current.lines[index] && current.syntax?.[index]?.length
            ? current.syntax[index].map((span, part) => span.role
              ? h(Text, { key: part, color: DASHBOARD_THEME.semantic.syntax[span.role] }, span.text)
              : span.text)
            : current.lines[index] || " ")));
    }
    return h(Panel, {
      title: fitText(`${focus === name ? "› " : ""}${title}`, contentWidth),
      width,
      color,
      separateHeader: true,
      bordered: name === "audit" ? layout.auditBorder : layout.treeBorder,
    },
    ...Array.from({ length: bodyRows }, (_, index) =>
      h(Text, { key: `${name}-${currentPage}-${index}`, wrap: "truncate-end" },
        current.lines[index] || " ")));
  };
  const sourcePanel = layout.split || focus === "source"
    ? panel("source", page, layout.sourceWidth, layout.sourceBodyRows) : null;
  const auditPanel = layout.split || focus === "audit"
    ? panel("audit", auditPage, layout.sidebarWidth, layout.auditBodyRows) : null;
  const treePanel = layout.split || focus === "tree"
    ? panel("tree", treePage, layout.sidebarWidth, layout.treeBodyRows) : null;
  return h(Box, { flexDirection: "column", paddingX: 1, height: rows, flexShrink: 0 },
    layout.compact
      ? h(Text, { bold: true, wrap: "truncate-end" }, fitText(`SOURCE PREVIEW · ${layout.metadata}`, columns - 2))
      : h(DashboardHeader, { versionLabel, screenName: "SOURCE PREVIEW", metadata: layout.metadata, columns }),
    h(Box, { marginTop: 1, height: layout.bodyRows, flexShrink: 0 },
      layout.split
        ? h(React.Fragment, null, sourcePanel,
          h(Box, { flexDirection: "column", marginLeft: 1 },
            auditPanel, h(Box, { marginTop: 1 }, treePanel)))
        : focus === "source" ? sourcePanel : focus === "audit" ? auditPanel : treePanel),
    ...layout.footer.map((line, index) => h(Text, {
      key: `inspection-shortcut-${index}`, color: DASHBOARD_THEME.semantic.accents.muted, wrap: "truncate-end",
    }, line)));
}
