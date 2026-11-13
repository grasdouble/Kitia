"use strict";
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");
const { CatalogError, SOURCE_SKILL_DIRECTORIES } = require("../resources/index.js");
import type { CatalogResource } from "../entries.js";
const DEFAULT_GH_SKILL_TIMEOUT_MS = 120_000;

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


function safeProgressText(value: string): string {
  return value
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{12,}\b/gi, "[REDACTED]")
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/gi, "$1 [REDACTED]")
    .replace(/\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|secret|password)\b["']?\s*[:=]\s*["']?([^\s"',;}&]+)/gi, "$1=[REDACTED]")
    .replace(/\b(gh[_-]?)?(token|authorization)\b["']?\s*[:=]\s*["']?([^\s"',;}&]+)/gi, "$1$2=[REDACTED]")
    .replace(/\b(https?:\/\/)[^/?#@\s]+@/gi, "$1[REDACTED]@")
    .replace(/(https?:\/\/[^?\s]+)\?[^\s]*/gi, "$1?[REDACTED]")
    .trim()
    .slice(0, 240);
}

function runGhSkillAsync(
  args: string[],
  cwd = process.cwd(),
  {
    nonInteractive = false,
    timeout = DEFAULT_GH_SKILL_TIMEOUT_MS,
    onProgress = () => {},
    spawnProcess = spawn,
  }: {
    nonInteractive?: boolean;
    timeout?: number;
    onProgress?: (message: string) => void;
    spawnProcess?: typeof spawn;
  } = {},
): Promise<GhSkillResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess("gh", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        ...(nonInteractive ? { env: { ...process.env, GH_PROMPT_DISABLED: "1" } } : {}),
      });
    } catch (error) {
      reject(ghSpawnError(error));
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    type ProgressStream = {
      remainder: string;
      pendingStatus: string;
      timer?: NodeJS.Timeout;
    };
    const progressStreams: Record<"stdout" | "stderr", ProgressStream> = {
      stdout: { remainder: "", pendingStatus: "" },
      stderr: { remainder: "", pendingStatus: "" },
    };
    const flushStatus = (stream: "stdout" | "stderr") => {
      const state = progressStreams[stream];
      if (state.timer) clearTimeout(state.timer);
      state.timer = undefined;
      const safe = safeProgressText(state.pendingStatus);
      state.pendingStatus = "";
      if (safe) onProgress(`gh ${stream}: ${safe}`);
    };
    const consumeProgress = (chunk: string, stream: "stdout" | "stderr", final = false) => {
      const state = progressStreams[stream];
      const text = state.remainder + chunk;
      let start = 0;
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char !== "\r" && char !== "\n") continue;
        if (char === "\r" && index === text.length - 1 && !final) break;
        const isCrLf = char === "\r" && text[index + 1] === "\n";
        const line = text.slice(start, index);
        if (char === "\n" || isCrLf) {
          flushStatus(stream);
          const safe = safeProgressText(line);
          if (safe) onProgress(`gh ${stream}: ${safe}`);
          if (isCrLf) index += 1;
        } else {
          state.pendingStatus = line.slice(-2048);
          if (!state.timer) {
            state.timer = setTimeout(() => flushStatus(stream), 150);
            state.timer.unref();
          }
        }
        start = index + 1;
      }
      state.remainder = text.slice(start).slice(-2048);
      if (!final) return;
      flushStatus(stream);
      const safeRemainder = safeProgressText(state.remainder);
      state.remainder = "";
      if (safeRemainder) onProgress(`gh ${stream}: ${safeRemainder}`);
    };
    const clearProgressTimers = () => {
      for (const state of Object.values(progressStreams)) {
        if (state.timer) clearTimeout(state.timer);
        state.timer = undefined;
      }
    };
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout = `${stdout}${text}`.slice(-65_536);
      consumeProgress(text, "stdout");
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr = `${stderr}${text}`.slice(-65_536);
      consumeProgress(text, "stderr");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      onProgress("GitHub CLI timed out; stopping the operation...");
      child.kill("SIGTERM");
      const forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      forceTimer.unref();
    }, timeout);
    timer.unref();
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearProgressTimers();
      reject(ghSpawnError(error));
    });
    child.once("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      consumeProgress("", "stdout", true);
      consumeProgress("", "stderr", true);
      clearProgressTimers();
      if (timedOut) {
        const error = new CatalogError(
          `GitHub CLI did not finish within ${Math.ceil(timeout / 1000)} seconds; check network connectivity and retry.`,
          "GH_TIMEOUT",
          { category: "github-cli", userMessage: "GitHub CLI timed out while installing or updating the source skill. Check network connectivity and retry." },
        );
        reject(error);
        return;
      }
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}

function ghSpawnError(error: Error & { code?: string }): Error {
  const code = error.code || "process launch failed";
  return new CatalogError(
    `Could not start GitHub CLI for source skill update: ${code}. Check that gh is installed and available on PATH.`,
    "GH_SPAWN_FAILED",
    {
      category: "github-cli",
      userMessage: "Could not start GitHub CLI for the source skill update. Check that gh is installed and available on PATH.",
    },
  );
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
  buildSourceSkillArgs, runGhSkill, runGhSkillAsync, formatGhDiagnostics, describeGhFailure,
};
