"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { CatalogError, SOURCE_SKILL_DIRECTORIES } = require("../resources/index.js");
import type { CatalogResource } from "../entries.js";

export type GhSkillResult = { status: number; stdout?: string | Buffer | null; stderr?: string | Buffer | null };
function buildSourceSkillArgs(
  action: string,
  resource: CatalogResource,
  agent?: string,
  { force = false, scope = "project", target }: { force?: boolean; scope?: string; target?: string } = {},
): string[] {
  if (action === "preview") {
    return [
      "skill", "preview", resource.source_repository,
      `${resource.source_path}@${resource.source_ref}`,
    ];
  }
  if (action === "install" && ["claude-code", "github-copilot"].includes(agent)) {
    if (scope === "user" && (!target || !path.isAbsolute(target))) {
      throw new CatalogError("User-scope source installation requires an absolute home directory");
    }
    return [
      "skill", "install", resource.source_repository, resource.source_path,
      "--agent", agent, "--scope", scope, "--pin", resource.source_ref,
      ...(scope === "user" ? ["--dir", path.join(target, SOURCE_SKILL_DIRECTORIES[agent])] : []),
      ...(force ? ["--force"] : []),
    ];
  }
  throw new CatalogError(`Unsupported source skill action: ${action}`);
}

function runGhSkill(
  args: string[],
  cwd = process.cwd(),
  spawn: typeof spawnSync = spawnSync,
  { nonInteractive = false, captureOutput = false }: { nonInteractive?: boolean; captureOutput?: boolean } = {},
): number | GhSkillResult {
  let result;
  try {
    result = spawn("gh", args, {
      cwd,
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : nonInteractive ? ["ignore", "inherit", "inherit"] : "inherit",
      ...(captureOutput ? { encoding: "utf8" } : {}),
      ...(nonInteractive ? { env: { ...process.env, GH_PROMPT_DISABLED: "1" } } : {}),
    });
  } catch (error) {
    const code = (error as Error & { code?: string }).code || "process launch failed";
    throw new CatalogError(
      `Could not start GitHub CLI for source skill update: ${code}. Check that gh is installed and available on PATH.`,
      "GH_SPAWN_FAILED",
      {
        category: "github-cli",
        userMessage: "Could not start GitHub CLI for the source skill update. Check that gh is installed and available on PATH.",
      },
    );
  }
  if (result.error) {
    throw new CatalogError(
      `Could not start GitHub CLI for source skill update: ${result.error.code || "process launch failed"}. Check that gh is installed and available on PATH.`,
      "GH_SPAWN_FAILED",
      {
        category: "github-cli",
        userMessage: "Could not start GitHub CLI for the source skill update. Check that gh is installed and available on PATH.",
      },
    );
  }
  const status = result.status ?? 1;
  return captureOutput ? { status, stdout: result.stdout, stderr: result.stderr } : status;
}

function formatGhDiagnostics(result: GhSkillResult): string {
  const raw = result.stderr || result.stdout;
  if (raw == null) return "";
  const text = raw.toString()
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{12,}\b/gi, "[REDACTED]")
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/gi, "$1 [REDACTED]")
    .replace(/\b(gh[_-]?)?(token|authorization|password)\b["']?\s*[:=]\s*["']?([^\s"',;}&]+)/gi, "$1$2=[REDACTED]")
    .trim();
  if (!text) return "";
  const limit = 400;
  return text.length > limit ? `${text.slice(0, limit)}… [diagnostic truncated]` : text;
}


function describeGhFailure(diagnostic: string): string {
  const text = diagnostic.toLowerCase();
  if (/rate.?limit|api rate limit/.test(text)) return "GitHub reports an API rate limit; wait for the limit to reset, then retry.";
  if (/not logged in|authentication|bad credentials|unauthorized|http 401|status 401/.test(text)) {
    return "GitHub CLI authentication failed; run `gh auth login` and verify repository access.";
  }
  if (/repository not found|could not read from remote|not found|http 404/.test(text)) {
    return "The repository or pinned resource was not found; verify the catalog repository, pin, and your access.";
  }
  if (/could not resolve host|connection refused|network is unreachable|timed? out|temporary failure|tls handshake|no such host/.test(text)) {
    return "GitHub could not be reached; check the network connection and retry.";
  }
  return "gh did not provide a recognized cause. Check GitHub CLI authentication, repository access, network connectivity, and the pinned resource, then retry.";
}

module.exports = {
  buildSourceSkillArgs, runGhSkill, formatGhDiagnostics, describeGhFailure,
};
