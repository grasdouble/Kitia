"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import { DASHBOARD_THEME } from "../colors.js";
import { fitColumn, fitText, wrapText } from "../helpers.mjs";
import { DASHBOARD_HEADER_ROWS, DashboardHeader, Panel, ShortcutsPanel, wrappedShortcutLines } from "./shared.mjs";

const h = React.createElement;
type InspectionScreenState = {
  action: "preview" | "audit";
  resource: CatalogResource;
  content: string;
  page: number;
};

const inspectionShortcuts = ["←/→ page · PGUP/PGDN page", "ENTER / ESC close"];

type InspectionPage = { title: string; lines: string[] };

function fallbackPreviewTree(resource: CatalogResource, filePath: string) {
  const sourceParts = (resource.source_path || "").split("/").filter(Boolean);
  const root = resource.kind === "skill"
    ? sourceParts.at(-1) === "SKILL.md" ? sourceParts.at(-2) : sourceParts.at(-1)
    : resource.id;
  return [`${root || resource.id}/`, `└── ${filePath}`];
}

function parsePreviewFiles(resource: CatalogResource, content: string) {
  const lines = content.split(/\r?\n/);
  const fileHeader = /^\s*(?:─+|—+|–+|-{2,})\s*(.+?)\s*(?:─+|—+|–+|-{2,})\s*$/u;
  const headers = lines.flatMap((line, index) => {
    const match = line.match(fileHeader);
    return match ? [{ index, path: match[1].trim() }] : [];
  });
  if (!headers.length) {
    const sourcePath = (resource.source_path || "").split("/").filter(Boolean).at(-1);
    const filePath = resource.kind === "skill" ? "SKILL.md" : sourcePath || `${resource.id}.md`;
    return {
      treeLines: fallbackPreviewTree(resource, filePath),
      files: [{ path: filePath, lines }],
    };
  }
  const treeLines = lines.slice(0, headers[0].index);
  while (treeLines.length && !treeLines.at(-1)?.trim()) treeLines.pop();
  const files = headers.map((header, index) => {
    const end = headers[index + 1]?.index ?? lines.length;
    const fileLines = lines.slice(header.index + 1, end);
    while (fileLines.length && !fileLines[0]?.trim()) fileLines.shift();
    while (fileLines.length && !fileLines.at(-1)?.trim()) fileLines.pop();
    return { path: header.path, lines: fileLines.length ? fileLines : ["(empty file)"] };
  });
  return {
    treeLines: treeLines.length ? treeLines : fallbackPreviewTree(resource, files[0].path),
    files,
  };
}

function chunkInspectionLines(title: string, lines: string[], pageSize: number): InspectionPage[] {
  const chunks = [];
  for (let offset = 0; offset < lines.length; offset += pageSize) {
    chunks.push(lines.slice(offset, offset + pageSize));
  }
  if (!chunks.length) chunks.push([""]);
  return chunks.map((chunk, index) => ({
    title: chunks.length > 1 ? `${title} · PART ${index + 1}/${chunks.length}` : title,
    lines: chunk,
  }));
}

function inspectionLayout({
  action, resource, content, columns, rows,
}: Pick<InspectionScreenState, "action" | "resource" | "content"> & { columns: number; rows: number }) {
  const contentWidth = Math.max(1, columns - 6);
  const labelWidth = Math.min(11, Math.max(1, Math.floor(contentWidth / 3)));
  const valueWidth = Math.max(1, contentWidth - labelWidth - 2);
  const metadataFields: Array<[string, string]> = [
    ["CATALOG", resource.catalog || "source"],
    ["RESOURCE", `${resource.kind}:${resource.id}`],
    ["REPOSITORY", resource.source_repository || "-"],
    ["PATH", resource.source_path || "-"],
    ["REVISION", resource.source_ref || "default branch"],
    ["LICENSE", resource.license_status || resource.license_spdx || "not declared"],
    ...(resource.description ? [["DESCRIPTION", resource.description] as [string, string]] : []),
  ];
  const metadataLines = metadataFields.flatMap(([label, value]) =>
    wrapText(value, valueWidth)
      .map((line, index) => ({
        label: index === 0 ? fitColumn(label, labelWidth) : " ".repeat(labelWidth),
        value: line,
      })));
  const metadata = `${resource.catalog || "source"} / ${resource.kind}:${resource.id}`;
  const metadataPanelRows = metadataLines.length + 4;
  const shortcutRows = wrappedShortcutLines(inspectionShortcuts, columns - 2).length + 4;
  const maxBodyRows = Math.max(
    1,
    rows - DASHBOARD_HEADER_ROWS - metadataPanelRows - 4 - shortcutRows - 1,
  );
  const pages = action === "preview"
    ? (() => {
      const { treeLines, files } = parsePreviewFiles(resource, content);
      const tree = chunkInspectionLines(
        "SOURCE TREE",
        treeLines.flatMap((line) => wrapText(line, contentWidth)),
        maxBodyRows,
      );
      return [
        ...tree,
        ...files.flatMap(({ path, lines }) =>
          chunkInspectionLines(
            `FILE ${path}`,
            lines.flatMap((line) => wrapText(line, contentWidth)),
            maxBodyRows,
          )),
      ];
    })()
    : chunkInspectionLines(
      "AUDIT REPORT",
      (content ? content.split(/\r?\n/) : ["No output was returned."])
        .flatMap((line) => wrapText(line, contentWidth)),
      maxBodyRows,
    );
  return { metadata, metadataLines, contentWidth, valueWidth, maxBodyRows, pages };
}

export function inspectionPageCount(options: Pick<InspectionScreenState, "action" | "resource" | "content"> & {
  columns: number;
  rows: number;
}) {
  return inspectionLayout(options).pages.length;
}

export function inspectionPageView(options: Pick<InspectionScreenState, "action" | "resource" | "content" | "page"> & {
  columns: number;
  rows: number;
}) {
  const { pages } = inspectionLayout(options);
  const currentPage = Math.max(0, Math.min(pages.length - 1, options.page));
  return {
    ...pages[currentPage],
    page: currentPage,
    pageCount: pages.length,
  };
}

export function InspectionScreen({
  action, resource, content, page, versionLabel, columns, rows,
}: InspectionScreenState & { versionLabel: string; columns: number; rows: number }) {
  const {
    metadata, metadataLines, contentWidth, valueWidth, maxBodyRows, pages,
  } = inspectionLayout({ action, resource, content, columns, rows });
  const currentPage = Math.max(0, Math.min(pages.length - 1, page));
  const bodyLines = pages[currentPage].lines.slice(0, maxBodyRows);
  while (bodyLines.length < maxBodyRows) bodyLines.push(" ");
  const title = action === "preview" ? "SOURCE PREVIEW" : "RESOURCE AUDIT";
  return h(Box, { flexDirection: "column", paddingX: 1, height: rows, flexGrow: 1, flexShrink: 1 },
    h(DashboardHeader, {
      versionLabel,
      screenName: title,
      metadata,
      columns,
    }),
    h(Panel, { title: "RESOURCE METADATA", marginTop: 1 },
      ...metadataLines.map(({ label, value }, index) => h(Text, {
        key: `inspection-metadata-${index}`,
        wrap: "truncate-end",
      },
      h(Text, { color: DASHBOARD_THEME.semantic.accents.label, bold: true }, `${label}  `),
      h(Text, { color: DASHBOARD_THEME.semantic.accents.muted }, fitText(value, valueWidth))))),
    h(Panel, {
      title: fitText(`PAGE ${currentPage + 1}/${pages.length} · ${pages[currentPage].title}`, contentWidth),
      marginTop: 1,
      flexGrow: 1,
      flexShrink: 1,
    }, ...bodyLines.map((line, index) => h(Text, {
      key: `inspection-line-${currentPage}-${index}`,
      wrap: "truncate-end",
    }, line === " " ? " " : fitText(line, contentWidth)))),
    ShortcutsPanel({ lines: inspectionShortcuts, width: columns - 2, marginTop: 1 }));
}
