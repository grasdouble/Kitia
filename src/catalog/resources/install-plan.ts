"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { CatalogError, TOOLS, USER_INSTALLABLE_KINDS, addPlanEntry, assertInstallableResource } = require("./index.js");
const { readSourceFiles, resourceProvenance, injectProvenance } = require("./files.js");
import type { InstallPlanEntry } from "../plan.js";

function renderInstruction(resource, body, tool, provenance) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  const runtimeFields =
    tool === "claude"
      ? `paths: ${JSON.stringify(resource.applyTo)}\n`
      : tool === "copilot"
        ? `applyTo: ${JSON.stringify(resource.applyTo.join(", "))}\n`
        : "";
  const metadata = Object.entries(provenance)
    .map(([field, value]) => `  ${field}: ${JSON.stringify(value)}`)
    .join("\n");
  const frontmatter = `---\n${runtimeFields}metadata:\n${metadata}\n---\n\n`;
  return Buffer.from(`${frontmatter}${text}`, "utf8");
}

function buildInstallPlan(resources, catalogRoot, tool, buildInfo, { scope = "project" } = {}) {
  if (!TOOLS.has(tool)) {
    throw new CatalogError(`Tool must be one of: ${[...TOOLS].join(", ")}`);
  }
  const root = fs.realpathSync(catalogRoot);
  const plan = new Map<string, InstallPlanEntry>();

  for (const resource of resources) {
    assertInstallableResource(resource);
    if (scope === "user" && !USER_INSTALLABLE_KINDS.has(resource.kind)) {
      throw new CatalogError("--scope user only supports skills and agents", "INVALID_ARGUMENT");
    }
    for (const runtime of tool === "both" ? ["claude", "copilot"] : [tool]) {
      if (resource.compatibility[runtime].status === "unsupported") {
        throw new CatalogError(`${resource.kind} ${resource.id} does not support ${runtime}`, "UNSUPPORTED_RUNTIME");
      }
    }
    const sourceFiles = readSourceFiles(resource, root);
    const sharedProvenance = resourceProvenance(resource, root, buildInfo, "shared");
    if (resource.kind === "skill") {
      for (const [relativePath, content, executable] of sourceFiles) {
        const sharedContent =
          relativePath === "SKILL.md"
            ? injectProvenance(content, sharedProvenance, `${resource.id}/SKILL.md`)
            : content;
        if (tool === "copilot" || tool === "both") {
          addPlanEntry(
            plan,
            path.posix.join(".agents", "skills", resource.id, relativePath),
            sharedContent,
            executable,
          );
        }
        if (tool === "claude" || tool === "both") {
          const claudeContent =
            relativePath === "SKILL.md"
              ? injectProvenance(
                  content,
                  resourceProvenance(resource, root, buildInfo, "claude"),
                  `${resource.id}/SKILL.md`,
                )
              : content;
          addPlanEntry(
            plan,
            path.posix.join(".claude", "skills", resource.id, relativePath),
            claudeContent,
            executable,
          );
        }
      }
    } else if (resource.kind === "agent") {
      const content = sourceFiles[0][1];
      if (tool === "claude" || tool === "both") {
        addPlanEntry(
          plan,
          path.posix.join(".claude", "agents", `${resource.id}.md`),
          injectProvenance(
            content,
            resourceProvenance(resource, root, buildInfo, "claude"),
            resource.source,
          ),
        );
      }
      if (tool === "copilot" || tool === "both") {
        addPlanEntry(
          plan,
          path.posix.join(scope === "user" ? ".copilot" : ".github", "agents", `${resource.id}.agent.md`),
          injectProvenance(
            content,
            resourceProvenance(resource, root, buildInfo, "copilot"),
            resource.source,
          ),
        );
      }
    } else {
      const content = sourceFiles[0][1];
      if (tool === "claude" || tool === "both") {
        addPlanEntry(
          plan,
          path.posix.join(".claude", "rules", `${resource.id}.md`),
          renderInstruction(
            resource,
            content,
            "claude",
            resourceProvenance(resource, root, buildInfo, "claude"),
          ),
        );
      }
      if (tool === "copilot" || tool === "both") {
        addPlanEntry(
          plan,
          path.posix.join(".github", "instructions", `${resource.id}.instructions.md`),
          renderInstruction(
            resource,
            content,
            "copilot",
            resourceProvenance(resource, root, buildInfo, "copilot"),
          ),
        );
      }
    }
  }
  return plan;
}

module.exports = { buildInstallPlan };
