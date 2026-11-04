"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const catalogName = "MattPucock";
const repository = "https://github.com/demo/skills";
const sourceRepository = "demo/skills";
const sourceRef = "4ae23170123456789abcdef0123456789abcdef0";

const resources = [
  {
    id: "ask-matt",
    kind: "skill",
    description: "Route repository questions to a relevant showcase skill.",
    source_path: "skills/engineering/ask-matt",
    license_status: "MIT",
  },
  {
    id: "grill-me",
    kind: "skill",
    description: "Practice a structured interview with this showcase skill.",
    source_path: "skills/productivity/grill-me",
    license_status: "MIT",
  },
  {
    id: "plan-review",
    kind: "skill",
    description: "Review a plan for completeness and trade-offs.",
    source_path: "skills/engineering/plan-review",
    license_status: "MIT",
  },
  {
    id: "release-helper",
    kind: "agent",
    description: "Prepare a concise release checklist.",
    source_path: "agents/release-helper.agent.md",
    license_status: "MIT",
  },
  {
    id: "review-guide",
    kind: "instruction",
    description: "Apply review conventions to source changes.",
    source_path: "instructions/review-guide.instructions.md",
    apply_to: ["src/**"],
    license_status: "MIT",
  },
];

function writeJson(filePath, value) {
  return fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeManagedSkill(target, resource) {
  const file = path.join(target, ".agents", "skills", resource.id, "SKILL.md");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, [
    "---",
    `name: ${resource.id}`,
    `description: ${resource.description}`,
    "metadata:",
    `  github-repo: "${repository}"`,
    `  github-path: "${resource.source_path}"`,
    `  github-ref: "${sourceRef}"`,
    `  github-pinned: "${sourceRef}"`,
    "---",
    "",
    `Synthetic local showcase body for ${resource.id}.`,
    "",
  ].join("\n"));
}

async function seedShowcase(directory) {
  const home = path.join(directory, "home");
  const project = path.join(directory, "workspace");
  const config = path.join(directory, "config");
  const indexes = path.join(config, "source-catalogs");
  await Promise.all([
    fs.mkdir(path.join(home, ".agents", "skills", "herdr"), { recursive: true }),
    fs.mkdir(project, { recursive: true }),
    fs.mkdir(indexes, { recursive: true }),
  ]);

  const entries = [
    { kind: "skill", path: "skills/engineering" },
    { kind: "skill", path: "skills/productivity" },
    { kind: "agent", path: "agents" },
    { kind: "instruction", path: "instructions" },
  ];
  const manifest = {
    catalog_version: 1,
    sources: [{ name: catalogName, repository, mode: "custom", entries }],
  };
  const catalogIndex = {
    catalog_version: 1,
    catalog_name: catalogName,
    source_repository: sourceRepository,
    source_ref: sourceRef,
    resources,
  };
  await Promise.all([
    writeJson(path.join(config, "catalogSources.json"), manifest),
    writeJson(path.join(indexes, "catalogSources.json"), manifest),
    writeJson(path.join(indexes, `${catalogName}.json`), catalogIndex),
    fs.writeFile(
      path.join(home, ".agents", "skills", "herdr", "SKILL.md"),
      [
        "---",
        "name: herdr",
        "description: Example skill installed outside Kitia.",
        "---",
        "",
        "Deterministic unmanaged showcase content.",
        "",
      ].join("\n"),
    ),
  ]);

  await writeManagedSkill(project, resources[0]);
  await writeManagedSkill(home, resources[1]);
  const { recordSourceInstallation } = require(path.join(
    root, "dist", "catalog", "sources", "installed.js",
  ));
  for (const [target, resource] of [[project, resources[0]], [home, resources[1]]]) {
    recordSourceInstallation({
      ...resource,
      catalog: catalogName,
      source_repository: sourceRepository,
      source_ref: sourceRef,
    }, target, "github-copilot");
  }

  return { home, project, config, catalogName, repository, sourceRepository, sourceRef };
}

function showcaseEnvironment(fixture) {
  const env = {
    ...process.env,
    HOME: fixture.home,
    USERPROFILE: fixture.home,
    KITIA_CONFIG_DIR: fixture.config,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    FORCE_COLOR: "1",
  };
  delete env.NO_COLOR;
  return env;
}

module.exports = { root, resources, seedShowcase, showcaseEnvironment };
