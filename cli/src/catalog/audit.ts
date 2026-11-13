"use strict";

export type AuditKind = "skill" | "agent" | "instruction";
export type AuditFinding = {
  code: string;
  severity: "warning";
  path: string;
  line: number;
  message: string;
};
export type AuditFile = {
  path: string;
  kind: AuditKind;
  content: string | Buffer;
};
export type AuditResult = {
  findings: AuditFinding[];
  coverage: {
    discovered: number;
    analyzed: number;
    skipped: Array<{ path: string; reason: string }>;
    complete: boolean;
  };
};

const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;

const RULES: Array<{ code: string; pattern: RegExp; message: string }> = [
  {
    code: "instruction-override",
    pattern: /\b(?:ignore|disregard|forget|override|bypass)\b[^\n]{0,100}\b(?:previous|prior|above|system|developer|safety|instructions?|rules?)\b/i,
    message: "Attempts to override or disregard existing instructions.",
  },
  {
    code: "prompt-secrecy",
    pattern: /\b(?:reveal|print|expose|disclose|dump|repeat)\b[^\n]{0,100}\b(?:system prompt|developer message|hidden instructions?|secrets?)\b/i,
    message: "Requests disclosure of hidden instructions or secrets.",
  },
  {
    code: "credential-exfiltration",
    pattern: /\b(?:curl|wget|fetch|http(?:s)?\.request)\b[^\n]{0,180}(?:\$\{?(?:[A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\}?|\.ssh\/|id_rsa|credentials?)/i,
    message: "Transfers or requests to transfer likely credentials to a remote endpoint.",
  },
  {
    code: "secret-collection",
    pattern: /\b(?:cat|read|print|upload|send|copy)\b[^\n]{0,100}(?:\.ssh\/|\.aws\/|\.npmrc|\.env\b|id_rsa|credentials?\.(?:json|yaml|yml))/i,
    message: "Reads or collects a common secret or credential file.",
  },
  {
    code: "destructive-shell",
    pattern: /(?:\brm\s+(?:-[^\s]*r[^\s]*f[^\s]*|-[^\s]*f[^\s]*r[^\s]*)\s+(?:\/|~|\$HOME|\*|\.\.?\/)|\b(?:mkfs(?:\.[a-z0-9]+)?|shred)\s|\bdd\s+if=|\bgit\s+reset\s+--hard\b|\bformat\s+[a-z]:)/i,
    message: "Contains a command that can destructively remove or overwrite data.",
  },
  {
    code: "privileged-download-execution",
    pattern: /\b(?:curl|wget)\b[^\n]{0,140}\|\s*(?:sudo\s+)?(?:sh|bash)\b|\b(?:sudo\s+)?(?:sh|bash)\s+-c\s+['"]?[^\n]{0,80}(?:curl|wget)\b/i,
    message: "Downloads and executes remote content in a shell.",
  },
];

function normalizedText(file: AuditFile): { text?: string; reason?: string } {
  const bytes = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
  if (bytes.byteLength > MAX_FILE_BYTES) return { reason: `exceeds the ${MAX_FILE_BYTES} byte per-file limit` };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { reason: "is not valid UTF-8 text" };
  }
}

/** Deterministic, local-only checks for a bounded set of UTF-8 resource files. */

export function auditTextResources(files: AuditFile[]): AuditResult {
  const findings: AuditFinding[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let analyzed = 0;
  for (const [index, file] of files.entries()) {
    if (index >= MAX_FILES) {
      skipped.push({ path: file.path, reason: `exceeds the ${MAX_FILES} file audit limit` });
      continue;
    }
    const { text, reason } = normalizedText(file);
    if (text === undefined) {
      skipped.push({ path: file.path, reason: reason! });
      continue;
    }
    analyzed++;
    text.split(/\r?\n/).forEach((line, lineIndex) => {
      for (const rule of RULES) {
        if (rule.pattern.test(line)) {
          findings.push({
            code: rule.code,
            severity: "warning",
            path: file.path,
            line: lineIndex + 1,
            message: rule.message,
          });
        }
      }
    });
  }
  return {
    findings,
    coverage: { discovered: files.length, analyzed, skipped, complete: skipped.length === 0 },
  };
}

module.exports = { auditTextResources };
