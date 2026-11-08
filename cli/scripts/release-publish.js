const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function publishMarkers(planText, reportText) {
  const planDocument = JSON.parse(planText);
  if (!planDocument || planDocument.version !== 1 || !Array.isArray(planDocument.plan)) {
    throw new Error("Unsupported Changesets publish-plan output");
  }

  const planned = new Map();
  for (const chunk of planDocument.plan) {
    if (!Array.isArray(chunk)) throw new Error("Invalid Changesets publish-plan chunk");
    for (const release of chunk) {
      if (!release || typeof release.name !== "string" || typeof release.version !== "string") {
        throw new Error("Invalid Changesets publish-plan entry");
      }
      if (release.kind === "publish") planned.set(release.name, release);
      else if (release.kind !== "tag-only") throw new Error(`Unknown Changesets release kind: ${release.kind}`);
    }
  }

  const published = new Set();
  for (const [index, line] of reportText.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid Changesets output event on line ${index + 1}: ${error.message}`);
    }
    if (event?.type !== "git-tag") continue;
    if (typeof event.packageName !== "string" || typeof event.tag !== "string") {
      throw new Error(`Invalid Changesets git-tag event on line ${index + 1}`);
    }

    const release = planned.get(event.packageName);
    if (!release) continue;
    const packageTag = `${release.name}@${release.version}`;
    const rootTag = `v${release.version}`;
    if (event.tag === packageTag) published.add(`New tag: ${packageTag}`);
    else if (event.tag === rootTag) published.add("New tag:");
  }

  return [...published];
}

function runCommand(command, args, { cwd, env, stdout, stderr }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout.on("data", (chunk) => stdout.write(chunk));
    child.stderr.on("data", (chunk) => stderr.write(chunk));
    child.on("error", (error) => {
      stderr.write(`${error.message}\n`);
      finish({ code: 1 });
    });
    child.on("close", (code) => finish({ code: code ?? 1 }));
  });
}

async function runRelease({
  cwd = path.resolve(__dirname, "../.."),
  run = runCommand,
  stdout = process.stdout,
  stderr = process.stderr,
  tempRoot = os.tmpdir(),
} = {}) {
  const directory = fs.mkdtempSync(path.join(tempRoot, "kitia-changesets-"));
  const planPath = path.join(directory, "publish-plan.json");
  const reportPath = path.join(directory, "publish-output.jsonl");
  try {
    const planResult = await run("pnpm", ["exec", "changeset", "publish-plan", "--output", planPath], {
      cwd,
      env: process.env,
      stdout,
      stderr,
    });
    if (planResult.code !== 0) return planResult.code ?? 1;

    const publishResult = await run("pnpm", ["exec", "changeset", "publish"], {
      cwd,
      env: { ...process.env, CHANGESETS_OUTPUT: reportPath },
      stdout,
      stderr,
    });

    const planText = fs.readFileSync(planPath, "utf8");
    const reportText = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
    for (const marker of publishMarkers(planText, reportText)) stdout.write(`${marker}\n`);
    return publishResult.code ?? 1;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runRelease().then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(error); process.exitCode = 1; },
  );
}

module.exports = { publishMarkers, runRelease };
