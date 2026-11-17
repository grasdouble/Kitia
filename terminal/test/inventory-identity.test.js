"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { checkInstalledResources } = require("../dist/core/inventory/checks.js");
const { recordSourceInstallation, readInstalledSourceSkills } = require("../dist/core/inventory/inventory.js");
const { updateSourceResources } = require("../dist/core/installations/mutations.js");

const pinnedRef = "a".repeat(40);
const catalog = "sample-catalog";
const resource = {
  catalog,
  id: "shared-id",
  kind: "skill",
  description: "Tracked skill",
  source_repository: "example/resources",
  source_path: "skills/shared-id",
  source_ref: pinnedRef,
  license_status: "MIT",
};
const unrelatedResources = [
  {
    catalog, id: resource.id, kind: "agent", description: "Catalog agent",
    source_repository: "example/resources", source_path: "agents/shared-id.agent.md",
    source_ref: pinnedRef, license_status: "MIT",
  },
  {
    catalog, id: resource.id, kind: "instruction", description: "Catalog instruction",
    source_repository: "example/resources", source_path: "instructions/shared-id.instructions.md",
    source_ref: pinnedRef, license_status: "MIT", apply_to: ["claude", "copilot"],
  },
];
const skillDirectories = {
  copilot: [".agents/skills", "github-copilot"],
  claude: [".claude/skills", "claude-code"],
};
let temporary;

afterEach(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  temporary = undefined;
});

for (const order of ["skill-first", "skill-last"]) {
  for (const scope of ["project", "user"]) {
    for (const tool of ["copilot", "claude", "both"]) {
      test(`mixed-kind catalog identity keeps tracked ${scope} ${tool} skill when ${order}`, () => {
        temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-inventory-identity-"));
        const target = path.join(temporary, "target");
        fs.mkdirSync(target);
        const agents = tool === "both" ? Object.keys(skillDirectories) : [tool];
        for (const agent of agents) {
          const [directory, installationAgent] = skillDirectories[agent];
          const relativePath = `${directory}/shared-id/SKILL.md`;
          const skillFile = path.join(target, relativePath);
          fs.mkdirSync(path.dirname(skillFile), { recursive: true });
          fs.writeFileSync(skillFile, [
            "---",
            "name: shared-id",
            "description: Tracked skill",
            "metadata:",
            '  github-repo: "https://github.com/example/resources"',
            '  github-path: "skills/shared-id"',
            `  github-pinned: "${pinnedRef}"`,
            "---",
            "",
            "Tracked skill body.",
            "",
          ].join("\n"));
          recordSourceInstallation(resource, target, installationAgent);
        }

        const catalogResources = order === "skill-first"
          ? [resource, ...unrelatedResources]
          : [...unrelatedResources, resource];
        const installed = readInstalledSourceSkills(target, catalogResources, { catalog });
        assert.equal(installed.length, 1);
        assert.deepEqual(installed.map(({ resource: item }) => ({ kind: item.kind, id: item.id, catalog: item.catalog })), [
          { kind: "skill", id: resource.id, catalog },
        ]);
        assert.equal(installed[0].removed, false);
        assert.equal(installed[0].tracked, true);
        assert.equal(installed[0].installations.length, agents.length);
        assert.ok(installed[0].installations.every(({ provenanceMatches, ref }) => provenanceMatches && ref === pinnedRef));

        const checked = checkInstalledResources(target, catalogResources, {
          catalog,
          scope,
          revisionCache: new Map(),
        });
        assert.equal(checked.resources.length, 1);
        assert.equal(checked.resources[0].kind, "skill");
        assert.equal(checked.resources[0].status, "current");
        assert.ok(!checked.resources[0].issues?.some(({ code }) => code === "REMOVED_FROM_CATALOG"));
        assert.ok(!checked.messages.some((message) => message.includes("Removed from catalog")));
        const installedFiles = installed[0].installations.map(({ path: relativePath }) => [
          relativePath,
          fs.readFileSync(path.join(target, relativePath), "utf8"),
        ]);
        updateSourceResources(installed, target, { scope }, () => {
          assert.fail("a matching pinned skill update must not fetch source content");
        });
        const afterUpdate = readInstalledSourceSkills(target, catalogResources, { catalog });
        assert.equal(afterUpdate.length, 1);
        assert.equal(afterUpdate[0].resource.kind, "skill");
        assert.equal(afterUpdate[0].removed, false);
        assert.equal(afterUpdate[0].tracked, true);
        assert.ok(afterUpdate[0].installations.every(({ provenanceMatches, ref }) => provenanceMatches && ref === pinnedRef));
        assert.deepEqual(afterUpdate[0].installations.map(({ path: relativePath }) => [
          relativePath,
          fs.readFileSync(path.join(target, relativePath), "utf8"),
        ]), installedFiles);
      });
    }
  }
}
