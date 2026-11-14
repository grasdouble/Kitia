"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const {
  collectionData, collectionKeyId, importCollectionText, signCollectionManifest,
  validateCollectionManifest, verifyCollectionSignature,
} = require("../dist/catalog/collections.js");
const { loadUserSourceConfiguration } = require("../dist/catalog/sources/config.js");
const { loadSourceCatalogsFromDirectory } = require("../dist/catalog/sources/loader.js");
const { parseArguments } = require("../dist/cli/arguments.js");

let temporary;
const previousConfig = process.env.KITIA_CONFIG_DIR;
afterEach(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  temporary = null;
  if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
  else process.env.KITIA_CONFIG_DIR = previousConfig;
});

const sourceRef = "0123456789abcdef0123456789abcdef01234567";
const sourceResource = {
  catalog: "Team", kind: "agent", id: "release-helper", source_path: "agents/release-helper.md",
  source_repository: "example/tools", source_ref: sourceRef,
  description: "Release helper", license_status: "MIT",
};
function collectionManifest() {
  return collectionData([sourceResource], [{
    name: "Team", repository: "https://github.com/example/tools",
    repositoryId: "example/tools", mode: "basic", entries: [],
  }], ["Team:agent:release-helper"]);
}

function createEd25519Keys() {
  return crypto.generateKeyPairSync("ed25519");
}

test("signed collection import verifies canonical Ed25519 signature with the approved public key", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-collections-signed-"));
  process.env.KITIA_CONFIG_DIR = path.join(temporary, "config");
  const keys = createEd25519Keys();
  const manifest = signCollectionManifest(collectionManifest(), keys.privateKey);
  assert.equal(manifest.signature.key_id, collectionKeyId(keys.publicKey));
  assert.deepEqual(verifyCollectionSignature(manifest, keys.publicKey), {
    signed: true, key_id: manifest.signature.key_id,
  });
  assert.equal(validateCollectionManifest(manifest).length, 1);
  const reordered = {
    signature: Object.fromEntries(Object.entries(manifest.signature).reverse()),
    catalogs: manifest.catalogs.map((catalog) => Object.fromEntries(Object.entries(catalog).reverse())),
    collection_version: manifest.collection_version,
  };
  assert.equal(verifyCollectionSignature(reordered, keys.publicKey).signed, true);
  assert.throws(() => importCollectionText(JSON.stringify(manifest)), /explicitly approved out of band/);
  assert.deepEqual(importCollectionText(JSON.stringify(manifest), fs, { trustedKey: keys.publicKey }), ["Team"]);
});

test("signed collection rejects altered data and a different approved key before configuration writes", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-collections-signature-reject-"));
  process.env.KITIA_CONFIG_DIR = path.join(temporary, "config");
  const signer = createEd25519Keys();
  const wrongKey = createEd25519Keys();
  const manifest = signCollectionManifest(collectionManifest(), signer.privateKey);
  assert.throws(() => verifyCollectionSignature(manifest, wrongKey.publicKey), /does not match signer key_id/);
  assert.throws(() => importCollectionText(JSON.stringify(manifest), fs, { trustedKey: wrongKey.publicKey }), /does not match signer key_id/);
  const altered = structuredClone(manifest);
  altered.catalogs[0].resources[0].description = "Altered after signing";
  assert.throws(() => importCollectionText(JSON.stringify(altered), fs, { trustedKey: signer.publicKey }), /signature verification failed/);
  assert.equal(fs.existsSync(path.join(process.env.KITIA_CONFIG_DIR, "catalogSources.json")), false);
});

test("unsigned collections remain compatible unless a trusted key is required", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-collections-unsigned-"));
  process.env.KITIA_CONFIG_DIR = path.join(temporary, "config");
  const manifest = collectionManifest();
  const keys = createEd25519Keys();
  assert.deepEqual(verifyCollectionSignature(manifest), { signed: false, key_id: null });
  assert.throws(() => verifyCollectionSignature(manifest, keys.publicKey), /collection is unsigned/);
  assert.throws(() => importCollectionText(JSON.stringify(manifest), fs, { trustedKey: keys.publicKey }), /collection is unsigned/);
  assert.deepEqual(importCollectionText(JSON.stringify(manifest)), ["Team"]);
});

test("collection export writes pinned references and import restores a minimal selected index", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-collections-"));
  process.env.KITIA_CONFIG_DIR = path.join(temporary, "config");
  const sources = [{ name: "Team", repository: "https://github.com/example/tools", repositoryId: "example/tools", mode: "basic", entries: [] }];
  const manifest = collectionData([sourceResource], sources, ["Team:agent:release-helper"]);
  assert.deepEqual(manifest, {
    collection_version: 1,
    catalogs: [{
      name: "Team", repository: "https://github.com/example/tools", mode: "basic", source_ref: sourceRef,
      resources: [{
        kind: "agent", id: "release-helper", source_path: "agents/release-helper.md",
        description: "Release helper", license_status: "MIT",
      }],
    }],
  });
  assert.equal(JSON.stringify(manifest).includes("upstream body"), false);
  assert.deepEqual(importCollectionText(JSON.stringify(manifest)), ["Team"]);
  assert.deepEqual(loadUserSourceConfiguration().map(({ name, repositoryId }) => [name, repositoryId]), [["Team", "example/tools"]]);
  const cached = loadSourceCatalogsFromDirectory(path.join(process.env.KITIA_CONFIG_DIR, "source-catalogs"), loadUserSourceConfiguration());
  assert.equal(cached.length, 1);
  assert.equal(cached[0].source_ref, sourceRef);
  assert.equal(cached[0].source_path, "agents/release-helper.md");
});

test("collection import validates all references before changing configuration", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-collections-invalid-"));
  process.env.KITIA_CONFIG_DIR = path.join(temporary, "config");
  const invalid = {
    collection_version: 1,
    catalogs: [
      { name: "Good", repository: "https://github.com/example/good", source_ref: sourceRef, resources: [
        { kind: "agent", id: "helper", source_path: "agents/helper.md", description: "Helper", license_status: "MIT" },
      ] },
      { name: "Bad", repository: "https://github.com/example/bad", source_ref: "not-a-commit", resources: [] },
    ],
  };
  assert.throws(() => importCollectionText(JSON.stringify(invalid)), /full 40-character commit SHA/);
  assert.equal(fs.existsSync(path.join(process.env.KITIA_CONFIG_DIR, "catalogSources.json")), false);
  assert.throws(() => validateCollectionManifest({ collection_version: 1, catalogs: [{ ...invalid.catalogs[0], resources: [
    { ...invalid.catalogs[0].resources[0], source_path: "../outside.md" },
  ] }] }), /safe repository-relative/);
});

test("collection publication rolls back staged indexes and preserves both registries on rename failure", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-collections-rollback-"));
  const config = path.join(temporary, "config");
  const indexDirectory = path.join(config, "source-catalogs");
  process.env.KITIA_CONFIG_DIR = config;
  fs.mkdirSync(indexDirectory, { recursive: true });
  const rootRegistryPath = path.join(config, "catalogSources.json");
  const indexRegistryPath = path.join(indexDirectory, "catalogSources.json");
  const originalRootRegistry = `${JSON.stringify({ catalog_version: 1, sources: [] }, null, 2)}\n`;
  const originalIndexRegistry = `{"catalog_version":1,"sources":[]}\n`;
  fs.writeFileSync(rootRegistryPath, originalRootRegistry);
  fs.writeFileSync(indexRegistryPath, originalIndexRegistry);
  const manifest = collectionData([sourceResource], [{
    name: "Team", repository: "https://github.com/example/tools",
    repositoryId: "example/tools", mode: "basic", entries: [],
  }], ["Team:agent:release-helper"]);
  let injected = false;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === "renameSync") return (from, to) => {
        if (to === rootRegistryPath && !injected) {
          injected = true;
          throw new Error("injected publication failure");
        }
        return fs.renameSync(from, to);
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  assert.throws(() => importCollectionText(JSON.stringify(manifest), failingFs), /injected publication failure/);
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(rootRegistryPath, "utf8"), originalRootRegistry);
  assert.equal(fs.readFileSync(indexRegistryPath, "utf8"), originalIndexRegistry);
  assert.equal(fs.existsSync(path.join(indexDirectory, "Team.json")), false);
  assert.equal(fs.readdirSync(config).some((name) => /\.(stage|backup)$/.test(name)), false);
  assert.equal(fs.readdirSync(indexDirectory).some((name) => /\.(stage|backup)$/.test(name)), false);
});

test("collection CLI parses optional key files without changing catalog export parsing", () => {
  assert.deepEqual(parseArguments(["collection", "export", "team.json", "Team:agent:release-helper"]), {
    command: "collection", action: "export", file: "team.json", resourceSelectors: ["Team:agent:release-helper"],
  });
  assert.deepEqual(parseArguments([
    "collection", "export", "team.json", "Team:agent:release-helper", "--signing-key", "private.pem",
  ]), {
    command: "collection", action: "export", file: "team.json", signingKey: "private.pem",
    resourceSelectors: ["Team:agent:release-helper"],
  });
  assert.deepEqual(parseArguments(["collection", "import", "team.json", "--trusted-key", "approved.pem"]), {
    command: "collection", action: "import", file: "team.json", trustedKey: "approved.pem",
  });
  assert.equal(parseArguments(["catalog", "export", "catalogs.json"]).action, "export");
  assert.throws(() => parseArguments(["collection", "export", "team.json", "Team:agent:../bad"]), /Invalid resource selector/);
  assert.throws(() => parseArguments(["collection", "export", "team.json", "--signing-key"]), /requires a PEM file path/);
  assert.throws(() => parseArguments(["collection", "import", "team.json", "--trusted-key"]), /Usage:/);
});

test("real CLI collection export and import round-trip a local pinned catalog fixture", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-collections-cli-"));
  const source = { name: "Team", repository: "https://github.com/example/tools" };
  const registry = { catalog_version: 1, sources: [source] };
  const sourceConfig = path.join(temporary, "source-config");
  const sourceIndex = path.join(sourceConfig, "source-catalogs");
  fs.mkdirSync(sourceIndex, { recursive: true });
  fs.writeFileSync(path.join(sourceConfig, "catalogSources.json"), JSON.stringify(registry));
  fs.writeFileSync(path.join(sourceIndex, "catalogSources.json"), JSON.stringify(registry));
  fs.writeFileSync(path.join(sourceIndex, "Team.json"), JSON.stringify({
    catalog_version: 1,
    catalog_name: "Team",
    source_repository: "example/tools",
    source_ref: sourceRef,
    resources: [{
      kind: "agent", id: "release-helper", source_path: "agents/release-helper.md",
      description: "Release helper", license_status: "MIT",
    }],
  }));
  const collectionFile = path.join(temporary, "team.json");
  const cli = path.resolve(__dirname, "../bin/kitia.js");
  const run = (config, ...args) => execFileSync(process.execPath, [cli, ...args], {
    encoding: "utf8", env: { ...process.env, KITIA_CONFIG_DIR: config },
  });
  const exported = run(sourceConfig, "collection", "export", collectionFile, "Team:agent:release-helper");
  assert.match(exported, /Exported resource collection/);
  const manifest = JSON.parse(fs.readFileSync(collectionFile, "utf8"));
  assert.equal(manifest.catalogs[0].source_ref, sourceRef);
  assert.equal(JSON.stringify(manifest).includes("upstream body"), false);

  const importedConfig = path.join(temporary, "imported-config");
  const imported = run(importedConfig, "collection", "import", collectionFile);
  assert.match(imported, /Imported resource collection/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(importedConfig, "catalogSources.json"), "utf8")).sources[0].name, "Team");
  process.env.KITIA_CONFIG_DIR = importedConfig;
  const importedResources = loadSourceCatalogsFromDirectory(
    path.join(importedConfig, "source-catalogs"),
    loadUserSourceConfiguration(),
  );
  assert.equal(importedResources[0].source_ref, sourceRef);
});

test("real CLI signs exports and rejects missing, incorrect, or altered approvals", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-collections-cli-signature-"));
  const source = { name: "Team", repository: "https://github.com/example/tools" };
  const registry = { catalog_version: 1, sources: [source] };
  const sourceConfig = path.join(temporary, "source-config");
  const sourceIndex = path.join(sourceConfig, "source-catalogs");
  fs.mkdirSync(sourceIndex, { recursive: true });
  fs.writeFileSync(path.join(sourceConfig, "catalogSources.json"), JSON.stringify(registry));
  fs.writeFileSync(path.join(sourceIndex, "catalogSources.json"), JSON.stringify(registry));
  fs.writeFileSync(path.join(sourceIndex, "Team.json"), JSON.stringify({
    catalog_version: 1,
    catalog_name: "Team",
    source_repository: "example/tools",
    source_ref: sourceRef,
    resources: [{
      kind: "agent", id: "release-helper", source_path: "agents/release-helper.md",
      description: "Release helper", license_status: "MIT",
    }],
  }));

  const keys = crypto.generateKeyPairSync("ed25519");
  const wrongKeys = crypto.generateKeyPairSync("ed25519");
  const privateKeyPath = path.join(temporary, "signer-private.pem");
  const publicKeyPath = path.join(temporary, "signer-public.pem");
  const wrongPublicKeyPath = path.join(temporary, "wrong-public.pem");
  fs.writeFileSync(privateKeyPath, keys.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, keys.publicKey.export({ format: "pem", type: "spki" }));
  fs.writeFileSync(wrongPublicKeyPath, wrongKeys.publicKey.export({ format: "pem", type: "spki" }));

  const cli = path.resolve(__dirname, "../bin/kitia.js");
  const run = (config, ...args) => execFileSync(process.execPath, [cli, ...args], {
    encoding: "utf8", env: { ...process.env, KITIA_CONFIG_DIR: config },
  });
  const signedFile = path.join(temporary, "signed.json");
  const exported = run(
    sourceConfig, "collection", "export", signedFile, "Team:agent:release-helper",
    "--signing-key", privateKeyPath,
  );
  const signedManifest = JSON.parse(fs.readFileSync(signedFile, "utf8"));
  assert.match(exported, new RegExp(signedManifest.signature.key_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(signedManifest.signature.algorithm, "Ed25519");

  const expectFailure = (config, expected, ...args) => {
    assert.throws(() => run(config, "collection", "import", ...args), (error) => {
      assert.equal(error.status, 1);
      assert.match(error.stderr, expected);
      return true;
    });
    assert.equal(fs.existsSync(path.join(config, "catalogSources.json")), false);
  };
  expectFailure(path.join(temporary, "missing-key"), /explicitly approved out of band/, signedFile);
  expectFailure(path.join(temporary, "wrong-key"), /does not match signer key_id/, signedFile, "--trusted-key", wrongPublicKeyPath);

  const alteredFile = path.join(temporary, "altered.json");
  const altered = structuredClone(signedManifest);
  altered.catalogs[0].resources[0].description = "Changed after signing";
  fs.writeFileSync(alteredFile, JSON.stringify(altered));
  expectFailure(path.join(temporary, "altered"), /signature verification failed/, alteredFile, "--trusted-key", publicKeyPath);

  const importedConfig = path.join(temporary, "approved-import");
  const imported = run(importedConfig, "collection", "import", signedFile, "--trusted-key", publicKeyPath);
  assert.match(imported, /Imported resource collection/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(importedConfig, "catalogSources.json"), "utf8")).sources[0].name, "Team");
});
