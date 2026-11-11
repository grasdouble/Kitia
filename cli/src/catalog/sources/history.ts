"use strict";

const { execFileSync, execFile } = require("node:child_process");
const { CatalogError } = require("../resources/index.js");
import type { CatalogResource } from "../entries.js";
const { adaptiveColumnWidths } = require("../../table-layout.js");

const SOURCE_VERSION_PAGE_SIZE = 100;
const SOURCE_VERSION_MAX = 500;
function sourceHistoryPath(resource: CatalogResource): string | null {
  const { source_repository: repository, source_path: sourcePath } = resource;
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      typeof sourcePath !== "string" || !sourcePath || sourcePath.startsWith("/") ||
      sourcePath.includes("\\") || /[\u0000-\u001f\u007f-\u009f]/.test(sourcePath) ||
      sourcePath.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  if (resource.kind === "skill") return `${sourcePath}/SKILL.md`;
  if ((resource.kind === "agent" || resource.kind === "instruction") && /\.md$/i.test(sourcePath)) {
    return sourcePath;
  }
  return null;
}
function latestSourceVersionAtRef(
  resource: CatalogResource,
  ref: string,
  run = execFileSync,
): string | null {
  const historyPath = sourceHistoryPath(resource);
  if (!historyPath) return null;
  let response: string;
  try {
    response = run("gh", [
      "api", "-X", "GET", `repos/${resource.source_repository}/commits`,
      "-f", `path=${historyPath}`,
      "-f", `sha=${ref}`,
      "-F", "per_page=1",
    ], {
      encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String(error.stderr || error.message || "unknown error").trim().slice(0, 500);
    throw new CatalogError(`Cannot check GitHub source history for ${resource.source_repository}/${historyPath}: ${detail}`);
  }
  let commits;
  try {
    commits = JSON.parse(response);
  } catch {
    throw new CatalogError("GitHub CLI returned invalid JSON while checking source history.");
  }
  if (!Array.isArray(commits) || commits.length !== 1 ||
      !/^[a-f0-9]{40}$/i.test(commits[0]?.sha || "")) {
    throw new CatalogError("GitHub CLI returned an invalid source-history response.");
  }
  return commits[0].sha.toLowerCase();
}
function validateSourceVersionResource(resource: CatalogResource): void {
  if (!resource.source_repository || !sourceHistoryPath(resource)) {
    throw new CatalogError("Commit history is available only for GitHub source resources with supported file paths.", "INVALID_ARGUMENT");
  }
}
function sourceVersionArguments(resource: CatalogResource, page: number): string[] {
  const historyPath = sourceHistoryPath(resource);
  if (!historyPath) throw new CatalogError("Source resource has no supported GitHub history path.");
  return [
    "api", "-X", "GET", `repos/${resource.source_repository}/commits`,
    "-f", `path=${historyPath}`,
    "-F", `per_page=${SOURCE_VERSION_PAGE_SIZE}`,
    "-F", `page=${page}`,
  ];
}
function parseSourceVersionPage(response: string) {
  let commits;
  try {
    commits = JSON.parse(response);
  } catch {
    throw new CatalogError("GitHub CLI returned invalid JSON while listing source commit history.");
  }
  if (!Array.isArray(commits)) {
    throw new CatalogError("GitHub CLI returned an invalid commit-history response.");
  }
  const versions = [];
  for (const entry of commits) {
    const sha = entry?.sha;
    const commit = entry?.commit;
    const date = commit?.committer?.date;
    const message = commit?.message;
    if (!/^[a-f0-9]{40}$/i.test(sha || "") || typeof date !== "string" ||
        !Number.isFinite(Date.parse(date)) || typeof message !== "string" || !message.trim()) {
      throw new CatalogError("GitHub CLI returned an invalid commit in source history.");
    }
    versions.push({ sha: sha.toLowerCase(), date, subject: message.split(/\r?\n/, 1)[0] });
  }
  return { commits, versions };
}
function sourceHistoryFailure(resource: CatalogResource, error) {
  const detail = String(error.stderr || error.message || "unknown error").trim().slice(0, 500);
  return new CatalogError(
    `Cannot list GitHub commit history for ${resource.source_repository}/${sourceHistoryPath(resource) || resource.source_path}: ${detail}`,
  );
}
const runExecFile = (program, args, options) => {
  const { promise, resolve, reject } = (Promise as PromiseConstructor & {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve(value: T): void;
      reject(reason?: unknown): void;
    };
  }).withResolvers<string>();
  execFile(program, args, options, (error, stdout, stderr) => {
    if (error) {
      error.stderr = stderr;
      reject(error);
    } else {
      resolve(stdout);
    }
  });
  return promise;
};
function listSourceVersions(
  resource: CatalogResource,
  run = execFileSync,
): Array<{ sha: string; date: string; subject: string }> {
  validateSourceVersionResource(resource);
  const versions = [];
  for (let page = 1; page <= SOURCE_VERSION_MAX / SOURCE_VERSION_PAGE_SIZE; page += 1) {
    let response: string;
    try {
      response = run("gh", sourceVersionArguments(resource, page), {
        encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw sourceHistoryFailure(resource, error);
    }
    const parsed = parseSourceVersionPage(response);
    versions.push(...parsed.versions);
    if (parsed.commits.length < SOURCE_VERSION_PAGE_SIZE || versions.length >= SOURCE_VERSION_MAX) break;
  }
  return versions;
}
async function listSourceVersionsAsync(
  resource: CatalogResource,
  run = runExecFile,
): Promise<Array<{ sha: string; date: string; subject: string }>> {
  validateSourceVersionResource(resource);
  const versions = [];
  for (let page = 1; page <= SOURCE_VERSION_MAX / SOURCE_VERSION_PAGE_SIZE; page += 1) {
    let response: string;
    try {
      response = await run("gh", sourceVersionArguments(resource, page), {
        encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw sourceHistoryFailure(resource, error);
    }
    const parsed = parseSourceVersionPage(response);
    versions.push(...parsed.versions);
    if (parsed.commits.length < SOURCE_VERSION_PAGE_SIZE || versions.length >= SOURCE_VERSION_MAX) break;
  }
  return versions;
}
function uniqueSourceVersionPrefixes(versions): string[] {
  return versions.map(({ sha }) => {
    let length = 7;
    while (length < 40 && versions.some((version) =>
      version.sha !== sha && version.sha.startsWith(sha.slice(0, length)))) {
      length += 1;
    }
    return sha.slice(0, length);
  });
}
function formatSourceVersionTable(versions, terminalWidth) {
  const prefixes = uniqueSourceVersionPrefixes(versions);
  const interactive = Number.isFinite(terminalWidth);
  const shaContentWidth = Math.max(3, ...prefixes.map((prefix) => prefix.length));
  const dates = versions.map(({ date }) => interactive ? date.slice(0, 10) : date);
  const dateContentWidth = Math.max(10, ...dates.map((date) => date.length));
  const subjectContentWidth = Math.max(7, ...versions.map(({ subject }) => subject.length));
  const naturalWidth = shaContentWidth + dateContentWidth + subjectContentWidth + 4;
  const [shaWidth, dateWidth, subjectWidth] = adaptiveColumnWidths(
    terminalWidth || naturalWidth,
    [
      { contentWidth: shaContentWidth, minWidth: Math.min(shaContentWidth, 7), shrinkWeight: 1 },
      { contentWidth: dateContentWidth, minWidth: Math.min(dateContentWidth, 10), shrinkWeight: 2 },
      { contentWidth: subjectContentWidth, minWidth: Math.min(subjectContentWidth, 8), growWeight: 1, shrinkWeight: 3 },
    ],
    2,
  );
  const fit = (value, width) => {
    const text = String(value);
    return text.length > width
      ? `${text.slice(0, Math.max(0, width - 3))}...`
      : text.padEnd(width);
  };
  const rows = [
    `${fit("SHA", shaWidth)}  ${fit("DATE", dateWidth)}  ${fit("SUBJECT", subjectWidth)}`,
    `${"-".repeat(shaWidth)}  ${"-".repeat(dateWidth)}  ${"-".repeat(subjectWidth)}`,
  ];
  for (const [index, version] of versions.entries()) {
    rows.push(`${fit(prefixes[index], shaWidth)}  ${fit(dates[index], dateWidth)}  ${fit(version.subject, subjectWidth)}`);
  }
  return rows;
}
function resolveSourceVersionPrefix(versions, prefix: string): string {
  const matches = versions.filter(({ sha }) => sha.startsWith(prefix.toLowerCase()));
  if (matches.length !== 1) {
    throw new CatalogError(
      matches.length ? `Commit prefix '${prefix}' is ambiguous.` : `Commit prefix '${prefix}' was not found in source history.`,
      matches.length ? "AMBIGUOUS_RESOURCE" : "RESOURCE_NOT_FOUND",
    );
  }
  return matches[0].sha;
}

module.exports = {
  listSourceVersions, listSourceVersionsAsync, latestSourceVersionAtRef,
  uniqueSourceVersionPrefixes, formatSourceVersionTable, resolveSourceVersionPrefix,
};
