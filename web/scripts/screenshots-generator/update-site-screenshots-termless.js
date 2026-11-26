'use strict';

const { randomBytes } = require('node:crypto');

const sharp = require('sharp');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { version: kitiaVersion } = require('@grasdouble/kitia/package.json');
const { assertTermlessRuntime } = require('./termless-preflight.js');
const {
  closeShowcaseDashboard,
  launchShowcaseDashboard,
  screenshotOptions,
  screenshotTermlessTerminal,
  screenshotViewport,
  waitForInkOutput,
} = require('./site-showcase-terminal.js');

const assets = path.resolve(__dirname, '../../assets');
const captures = [
  {
    name: 'Termless inventory',
    staged: 'workspace-inventory.webp',
    output: 'workspace-inventory-termless.webp',
    draft: 'workspace-inventory-termless-draft.webp',
    png: 'workspace-inventory.png',
  },
  {
    name: 'Termless catalog',
    staged: 'catalog-browser.webp',
    output: 'catalog-browser-termless.webp',
    draft: 'catalog-browser-termless-draft.webp',
    png: 'catalog-browser.png',
  },
];
const usage = `Capture Termless/xterm.js screenshots of Kitia's actual Ink dashboard.

Usage:
  pnpm --filter @grasdouble/kitia-web run screenshots:update:termless
  pnpm --filter @grasdouble/kitia-web run screenshots:update:termless --help

Requires Node.js >=23.6, a built checkout, @resvg/resvg-js, and sharp. The
command uses the shared deterministic showcase fixture and writes a separate
lossless WebP pair. It promotes to *-termless.webp only when the parsed xterm
screen proves both complete frames; otherwise it writes review-only
*-termless-draft.webp files, reports what was missing, and exits with an error.
The published captures are untouched on failure.`;

class CaptureError extends Error {}

function screenRows(screen) {
  return screen
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function missingInventory(screen) {
  const lines = screenRows(screen);
  const requirements = [
    ['selected project ask-matt row', /›\s+ask-matt\s+skill\s+project\s+Current\b/],
    ['unmanaged user unmanaged row', /\bunmanaged\s+skill\s+user\s+Unmanaged\b/],
    ['current user grill-me row', /\bgrill-me\s+skill\s+user\s+Current\b/],
    ['side-by-side inventory and detail titles', /INSTALLED RESOURCES.*3 results.*SELECTION DETAILS/],
    ['inventory summary cards', /│PROJECT\s+1│\s+│USER\s+2│\s+│UPDATES\s+0│/],
    ['inventory navigation shortcuts', /I Inventory.*B Browse resources.*M Manage catalogs/],
  ];
  const missing = requirements
    .filter(([, pattern]) => !lines.some((line) => pattern.test(line)))
    .map(([label]) => label);
  for (const value of ['MattPucock[engineering]', 'Route repository questions']) {
    if (!screen.includes(value)) missing.push(`selected ask-matt detail ${JSON.stringify(value)}`);
  }
  return missing;
}

function missingCatalog(screen) {
  const missing = ['CATALOG RESOURCES', 'ask-matt', 'grill-me', 'plan-review', 'release-helper', 'review-guide']
    .filter((value) => !screen.includes(value))
    .map((value) => `catalog ${JSON.stringify(value)}`);
  if (!/I Inventory[\s\S]*B Browse resources[\s\S]*M Manage catalogs/.test(screen)) {
    missing.push('Browse navigation shortcuts');
  }
  return missing;
}

async function validatePng(filePath, label) {
  const buffer = await fs.readFile(filePath);
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new CaptureError(`${label} did not produce a valid PNG.`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== screenshotViewport.width || height !== screenshotViewport.height) {
    throw new CaptureError(
      `${label} is ${width}×${height}; expected ${screenshotViewport.width}×${screenshotViewport.height}.`,
    );
  }
  return buffer;
}

async function encodeWebp(sourcePath, destinationPath, label) {
  try {
    await sharp(sourcePath).webp({ lossless: true, effort: 6 }).toFile(destinationPath);
    const metadata = await sharp(destinationPath).metadata();
    if (
      metadata.format !== 'webp' ||
      metadata.width !== screenshotViewport.width ||
      metadata.height !== screenshotViewport.height
    ) {
      throw new CaptureError(
        `${label} did not produce a valid ${screenshotViewport.width}×${screenshotViewport.height} WebP.`,
      );
    }
    return (await fs.stat(destinationPath)).size;
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    throw new CaptureError(`${label} could not be encoded as lossless WebP: ${error.message}`);
  }
}

async function replacePair(images, destinations) {
  const staged = [];
  try {
    for (let index = 0; index < destinations.length; index += 1) {
      const suffix = `${process.pid}.${randomBytes(6).toString('hex')}`;
      const item = {
        destination: destinations[index],
        temporary: path.join(assets, `.${path.basename(destinations[index])}.${suffix}.tmp`),
        backup: path.join(assets, `.${path.basename(destinations[index])}.${suffix}.bak`),
        source: images[index],
        temporaryCreated: false,
        backupCreated: false,
        committed: false,
      };
      staged.push(item);
      await fs.copyFile(item.source, item.temporary);
      item.temporaryCreated = true;
    }
    for (const item of staged) {
      let previous;
      try {
        previous = await fs.lstat(item.destination);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!previous) continue;
      if (!previous.isFile()) throw new CaptureError(`Termless destination is not a regular file: ${item.destination}`);
      await fs.copyFile(item.destination, item.backup);
      item.backupCreated = true;
    }
    for (const item of staged) {
      await fs.rename(item.temporary, item.destination);
      item.temporaryCreated = false;
      item.committed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const item of [...staged].reverse()) {
      if (!item.committed) continue;
      try {
        if (item.backupCreated) {
          await fs.rename(item.backup, item.destination);
          item.backupCreated = false;
        } else {
          await fs.rm(item.destination, { force: true });
        }
        item.committed = false;
      } catch (rollbackError) {
        rollbackErrors.push(`${item.destination}: ${rollbackError.message}`);
      }
    }
    for (const item of staged) {
      if (item.temporaryCreated) await fs.rm(item.temporary, { force: true });
      if (item.backupCreated && !item.committed) await fs.rm(item.backup, { force: true });
    }
    throw new CaptureError(
      `Could not replace the Termless screenshot pair: ${error.message}` +
        (rollbackErrors.length ? ` Rollback incomplete: ${rollbackErrors.join('; ')}` : ' Previous pair restored.'),
    );
  }
  for (const item of staged) {
    if (item.backupCreated) await fs.rm(item.backup, { force: true });
  }
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(usage);
    return;
  }
  if (args.length) {
    console.error(`Error: Unsupported argument: ${args[0]}\n\n${usage}`);
    process.exitCode = 2;
    return;
  }
  try {
    assertTermlessRuntime();
    await import('@resvg/resvg-js');
    await import('sharp');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'kitia-termless-capture-'));
  let session;
  try {
    session = await launchShowcaseDashboard(temporaryDirectory, { versionLabel: kitiaVersion });
    const staged = captures.map(({ png }) => path.join(temporaryDirectory, png));

    await waitForInkOutput(session, 'B Browse resources');
    const inventoryStart = session.rawBytes().length;
    session.input.write('h');
    const inventoryAnsi = await waitForInkOutput(session, '3 results', inventoryStart);
    await session.flushTerminal();
    const inventoryGrid = session.terminal.screen.getText();
    await fs.writeFile(staged[0], await screenshotTermlessTerminal(session.terminal));

    const catalogStart = session.rawBytes().length;
    session.input.write('b');
    const catalogAnsi = await waitForInkOutput(session, 'M Manage catalogs', catalogStart);
    await session.flushTerminal();
    const catalogGrid = session.terminal.screen.getText();
    await fs.writeFile(staged[1], await screenshotTermlessTerminal(session.terminal));

    const images = await Promise.all(staged.map((file, index) => validatePng(file, captures[index].name)));
    if (images[0].equals(images[1])) throw new CaptureError('The Termless screenshots are identical.');
    const optimized = captures.map(({ staged: file }) => path.join(temporaryDirectory, file));
    const sizes = await Promise.all(
      optimized.map((file, index) => encodeWebp(staged[index], file, captures[index].name)),
    );

    const missingVersion = (name, grid) =>
      screenRows(grid).some((line) => line.endsWith(`Version ${kitiaVersion}`))
        ? []
        : [`${name} header Version ${kitiaVersion}`];
    const inventoryMissing = [...missingInventory(inventoryGrid), ...missingVersion('Inventory', inventoryGrid)];
    const catalogMissing = [...missingCatalog(catalogGrid), ...missingVersion('Browse', catalogGrid)];
    const missing = [...inventoryMissing, ...catalogMissing];
    const complete = missing.length === 0;
    await fs.mkdir(assets, { recursive: true });
    const destinations = captures.map(({ output, draft }) => path.join(assets, complete ? output : draft));
    await replacePair(optimized, destinations);
    if (complete) {
      const obsoleteDrafts = captures.map(({ draft }) => path.join(assets, draft));
      await Promise.all(obsoleteDrafts.map((file) => fs.rm(file, { force: true })));
    }
    for (let index = 0; index < captures.length; index += 1) {
      console.log(
        `${captures[index].name} ${complete ? 'complete' : 'draft'}: ${screenshotViewport.width}×${screenshotViewport.height} → ${destinations[index]} (${sizes[index]} bytes, lossless WebP)`,
      );
    }
    console.log(
      `Termless xterm projection: inventory ${inventoryMissing.length ? 'incomplete' : 'complete'}; catalog ${catalogMissing.length ? 'incomplete' : 'complete'}.`,
    );
    console.log(`Ink stream evidence: inventory ${inventoryAnsi.length} chars; catalog ${catalogAnsi.length} chars.`);
    if (!complete) {
      throw new CaptureError(`Incomplete Termless screenshots; existing captures kept: ${missing.join('; ')}`);
    }
    console.log(
      `Rendered with @resvg/resvg-js using fixed ${screenshotViewport.width}×${screenshotViewport.height} cell metrics.`,
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (session) await closeShowcaseDashboard(session);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
