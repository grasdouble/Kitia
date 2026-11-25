'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  waitForOutput,
  selectedDetailsFrame,
  waitForDashboardFrame,
  selectedListRow,
  inventoryFrameReady,
  detailBodyText,
  assertSeparatedPanelHeader,
} = require('./dashboard-frames.js');

test('dashboard replaces an installed skill with the selected full revision through update confirmation', async (t) => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  t.after(() => {
    input.destroy();
    output.destroy();
  });
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = '';
  output.on('data', (chunk) => {
    rendered += chunk.toString();
  });
  const visibleFrame = () => {
    const start = rendered.lastIndexOf('\u001b[?2026h');
    const end = rendered.indexOf('\u001b[?2026l', start);
    return start >= 0 && end > start ? require('node:util').stripVTControlCharacters(rendered.slice(start, end)) : '';
  };
  const waitForFrame = (predicate, description) =>
    new Promise((resolve, reject) => {
      let timeout;
      const cleanup = () => {
        clearTimeout(timeout);
        output.off('data', onData);
        output.off('end', onEnd);
        output.off('close', onClose);
        output.off('error', onError);
      };
      const check = () => {
        const frame = visibleFrame();
        if (!predicate(frame)) return false;
        cleanup();
        resolve(frame);
        return true;
      };
      const onData = () => {
        check();
      };
      const onEnd = () => {
        cleanup();
        reject(new Error(`Dashboard output ended before rendering ${description}`));
      };
      const onClose = () => {
        cleanup();
        reject(new Error(`Dashboard output closed before rendering ${description}`));
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      if (check()) return;
      output.on('data', onData);
      output.once('end', onEnd);
      output.once('close', onClose);
      output.once('error', onError);
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Dashboard did not render ${description}`));
      }, 10_000);
    });
  const selectedSha = 'b'.repeat(40);
  const actions = [];
  const installed = {
    catalog: 'Test',
    kind: 'skill',
    id: 'revision-skill',
    scope: 'project',
    status: 'current',
    source_repository: 'org/repo',
    source_path: 'skills/revision-skill',
    source_ref: 'a'.repeat(40),
    paths: ['.agents/skills/revision-skill/SKILL.md', '.github/skills/revision-skill/SKILL.md'],
  };
  let resolveHistory;
  const historyRequest = new Promise((resolve) => {
    resolveHistory = resolve;
  });
  let resolveUpdate;
  const updateRequest = new Promise((resolve) => {
    resolveUpdate = resolve;
  });
  let markUpdateStarted;
  const updateStarted = new Promise((resolve) => {
    markUpdateStarted = resolve;
  });
  const done = runDashboard([installed], input, output, [], {
    catalogResources: [
      {
        catalog: 'Test',
        kind: 'skill',
        id: 'revision-skill',
        source_repository: 'org/repo',
        source_path: 'skills/revision-skill',
        source_ref: 'a'.repeat(40),
        license_status: 'MIT',
      },
    ],
    listSourceVersions: () => historyRequest,
    execute: async (action, resource, options) => {
      actions.push({
        action,
        resource: resource.id,
        scope: resource.scope,
        ref: options.ref,
        destinations: options.destinations,
      });
      markUpdateStarted();
      await updateRequest;
      return {
        code: 0,
        messages: ['Updated selected revision.'],
        resources: [installed],
        errors: [],
      };
    },
  });
  let dashboardFinished = false;
  void done.then(() => {
    dashboardFinished = true;
  });
  await waitForFrame((frame) => frame.includes('INSTALLED RESOURCES'), 'initial inventory');
  input.write('b');
  await waitForFrame((frame) => frame.includes('CATALOG RESOURCES'), 'catalog resources');
  input.write('v');
  const historyLoading = await waitForFrame(
    (frame) => frame.includes('Loading commit history for revision-skill'),
    'revision history loading popup',
  );
  assert.match(historyLoading, /Inventory 1\s+Browse resources 1\s+Manage Catalogs 0/);
  resolveHistory([
    {
      sha: 'a'.repeat(40),
      prefix: 'aaaaaaa',
      date: '2026-11-09T00:00:00Z',
      subject: 'Current pin',
    },
    {
      sha: selectedSha,
      prefix: 'bbbbbbb',
      date: '2026-11-08T00:00:00Z',
      subject: 'Previous revision',
    },
  ]);
  const revisionFrame = await waitForFrame((frame) => frame.includes('RESOURCE REVISIONS'), 'revision picker');
  assert.match(revisionFrame, /Inventory 1\s+Browse resources 1\s+Manage Catalogs 0/);
  const revisionBody = assertSeparatedPanelHeader(revisionFrame, 'RESOURCE REVISIONS', '', [
    'Test / skill:revision-skill',
    'Select a commit to update; the catalog pin remains unchanged.',
  ]).filter((line) => line.trim());
  assert.equal(revisionBody.length, 2, 'unpaginated revision rows stay below the divider without new column labels');
  assert.match(revisionBody[0], /› aaaaaaa\s+2026-11-09\s+Current pin/);
  assert.match(revisionBody[1], /bbbbbbb\s+2026-11-08\s+Previous revision/);
  input.write('\x1b[B');
  const selectedFrame = await waitForFrame((frame) => frame.includes('› bbbbbbb'), 'second revision selection');
  assert.ok(selectedFrame.includes('› bbbbbbb'), 'the second revision is selected before Enter');
  input.write('\r');
  const confirmationFrame = (
    await waitForFrame((frame) => frame.includes('CONFIRM UPDATE'), 'update confirmation')
  ).replace(/\s+/g, ' ');
  assert.match(confirmationFrame, /CONFIRM UPDATE/);
  assert.match(confirmationFrame, /Replace the installed skill:revision-skill/);
  assert.match(confirmationFrame, /revision in project scope\?/);
  assert.match(confirmationFrame, /Selected revision: b{40}/);
  assert.match(confirmationFrame, /Tracked paths:/);
  for (const path of installed.paths) assert.ok(confirmationFrame.includes(path));
  input.write('y');
  const loading = await waitForFrame(
    (frame) => frame.includes('Updating skill:revision-skill'),
    'update loading popup',
  );
  assert.ok(loading.includes('CATALOG RESOURCES'));
  await updateStarted;
  assert.deepEqual(actions, [
    {
      action: 'update',
      resource: 'revision-skill',
      scope: 'project',
      ref: selectedSha,
      destinations: undefined,
    },
  ]);
  input.write('q');
  assert.equal(dashboardFinished, false, 'input remains blocked while the loader popup is active');
  resolveUpdate();
  const updated = await waitForFrame(
    (frame) => frame.includes('CATALOG RESOURCES') && !frame.includes('LOADING') && !frame.includes('CONFIRM UPDATE'),
    'Browse after the selected revision update',
  );
  assert.match(updated, /›\s+revision-skill/);
  input.write('q');
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test('dashboard shows the loading popup for consecutive actions', async () => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = '';
  output.on('data', (chunk) => {
    rendered += chunk.toString();
  });
  let callCount = 0;
  const done = runDashboard([], input, output, [], {
    catalogResources: [
      {
        catalog: 'Test',
        kind: 'skill',
        id: 'repeat-skill',
        source_repository: 'org/repo',
        source_path: 'skills/repeat-skill',
        source_ref: 'a'.repeat(40),
        license_status: 'MIT',
      },
    ],
    execute: async () => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { code: 0, messages: ['Preview ready.'], resources: [], errors: [] };
    },
  });
  const latestFrame = () => {
    const start = rendered.lastIndexOf('\u001b[?2026h');
    const end = rendered.indexOf('\u001b[?2026l', start);
    return start >= 0 && end > start ? rendered.slice(start, end) : '';
  };
  const waitFor = (predicate, message) =>
    waitForOutput(output, latestFrame, predicate, `dashboard to ${message}`, 5_000);
  let finished = false;
  try {
    await waitFor((frame) => frame.includes('INSTALLED RESOURCES'), 'render Inventory');
    input.write('b');
    await waitFor((frame) => frame.includes('CATALOG RESOURCES'), 'open catalog');
    input.write('p');
    const firstLoading = await waitFor((frame) => frame.includes('LOADING'), 'show the first loading popup');
    assert.match(
      require('node:util').stripVTControlCharacters(firstLoading),
      /Inventory 0\s+Browse resources 1\s+Manage Catalogs 0/,
    );
    await waitFor((frame) => frame.includes('Preview ready.'), 'finish the first preview');
    assert.equal(callCount, 1);

    input.write('\r');
    await waitFor((frame) => frame.includes('CATALOG RESOURCES'), 'return to catalog');
    input.write('p');
    await waitFor((frame) => frame.includes('LOADING'), 'show the second loading popup');
    await waitFor(() => callCount === 2, 'start the second preview');
    await waitFor((frame) => frame.includes('Preview ready.'), 'finish the second preview');
    input.write('\r');
    await waitFor((frame) => frame.includes('CATALOG RESOURCES'), 'return to catalog again');
    input.write('q');
    assert.equal(await done, true);
    finished = true;
  } finally {
    if (!finished) {
      input.destroy();
      await done;
    } else {
      input.destroy();
    }
    output.destroy();
  }
});

test('dashboard revision picker applies a selected full SHA to a confirmed instruction update', async () => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = '';
  output.on('data', (chunk) => {
    rendered += chunk.toString();
  });
  const selectedSha = 'c'.repeat(40);
  const installedInstruction = {
    catalog: 'Test',
    kind: 'instruction',
    id: 'review',
    managed: true,
    scope: 'project',
    status: 'current',
    source_repository: 'org/repo',
    source_path: '.github/instructions/review.instructions.md',
    source_ref: 'a'.repeat(40),
    paths: ['.github/instructions/review.instructions.md', '.claude/rules/review.md'],
  };
  const actions = [];
  const done = runDashboard([installedInstruction], input, output, [], {
    listSourceVersions: () => [
      {
        sha: 'a'.repeat(40),
        prefix: 'aaaaaaa',
        date: '2026-11-09T00:00:00Z',
        subject: 'Current pin',
      },
      {
        sha: selectedSha,
        prefix: 'ccccccc',
        date: '2026-11-08T00:00:00Z',
        subject: 'Previous revision',
      },
    ],
    execute: async (action, resource, options) => {
      actions.push({ action, resource: resource.id, ref: options.ref });
      return {
        code: 0,
        messages: ['Updated selected revision.'],
        resources: [{ ...installedInstruction, source_ref: selectedSha }],
        errors: [],
      };
    },
  });
  const press = (key, predicate, description) => {
    const start = rendered.length;
    input.write(key);
    return waitForDashboardFrame(output, () => rendered, predicate, description, start);
  };
  let finished = false;
  try {
    await waitForDashboardFrame(
      output,
      () => rendered,
      (frame) => selectedListRow(frame) === 'review' && frame.includes('Revisions') && frame.includes('Q quit'),
      'selected instruction with a revision action',
    );
    await press(
      'v',
      (frame) =>
        frame.includes('RESOURCE REVISIONS') && frame.includes('Current pin') && frame.includes('Previous revision'),
      'both instruction revisions',
    );
    const revisionBody = assertSeparatedPanelHeader(selectedDetailsFrame(rendered), 'RESOURCE REVISIONS', '', [
      'Test / instruction:review',
      'Select a commit to update; the catalog pin remains unchanged.',
    ]).filter((line) => line.trim());
    assert.equal(
      revisionBody.length,
      2,
      'the existing update context moves into the header without consuming revision rows',
    );
    assert.match(revisionBody[0], /› aaaaaaa\s+2026-11-09\s+Current pin/);
    await press(
      '\x1b[B',
      (frame) => frame.includes('RESOURCE REVISIONS') && frame.includes('› ccccccc'),
      'selected revision',
    );
    const confirmation = await press(
      '\r',
      (frame) =>
        frame.includes('CONFIRM UPDATE') && frame.includes(selectedSha) && !frame.includes('RESOURCE REVISIONS'),
      'update confirmation with selected SHA',
    );
    for (const path of installedInstruction.paths) assert.ok(confirmation.includes(path));
    let updated = await press(
      'y',
      (frame) =>
        inventoryFrameReady(frame) &&
        selectedListRow(frame) === installedInstruction.id &&
        !frame.includes('CONFIRM UPDATE') &&
        !frame.includes('PLEASE WAIT'),
      'Inventory after the confirmed update',
    );
    let details = detailBodyText(updated);
    for (let page = 0; page < 12 && !details.includes('MESSAGEUpdatedselectedrevision.'); page += 1) {
      const previous = detailBodyText(updated);
      updated = await press(
        '\x1b[6~',
        (frame) => inventoryFrameReady(frame) && detailBodyText(frame) !== previous,
        'next update result page',
      );
      details += detailBodyText(updated);
    }
    assert.match(details, /INSTALLEDREVISIONccccccc/);
    assert.match(details, /MESSAGEUpdatedselectedrevision\./);
    assert.deepEqual(actions, [{ action: 'update', resource: 'review', ref: selectedSha }]);
    input.write('q');
    assert.equal(await done, true);
    finished = true;
  } finally {
    input.destroy();
    if (!finished) await done.catch(() => {});
    output.destroy();
  }
});

async function exerciseVersionNotice(decision) {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  const previousVersion = process.env.KITIA_INSTALLED_VERSION;
  const previousFetch = global.fetch;
  process.env.KITIA_INSTALLED_VERSION = '1.0.0';
  global.fetch = async () => ({ ok: true, json: async () => ({ version: '1.0.2' }) });
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = '';
  output.on('data', (chunk) => {
    rendered += chunk.toString();
  });
  let done;
  let requests = 0;
  try {
    done = runDashboard([], input, output, [], {
      prepareSelfUpdate: async () => ({
        manager: 'pnpm',
        request: () => {
          requests += 1;
        },
      }),
    });
    const frame = await waitForDashboardFrame(
      output,
      () => rendered,
      (text) => text.includes('NEW VERSION AVAILABLE') && text.includes('UPDATE │'),
      'the available-version notice with an update button',
    );
    assert.match(frame.split('\n').slice(0, 5).join('\n'), /Version 1\.0\.0[ \t]*$/m);
    assert.match(frame, /Installed: 1\.0\.0/);
    assert.match(frame, /Available: 1\.0\.2/);
    assert.match(frame, /github\.com\/grasdouble\/Kitia\/blob\/main\/app\/CHANGELOG\.md#102/);
    assert.match(frame, /global installation with pnpm/);
    assert.equal(requests, 0);
    if (decision === 'later') {
      input.write('\r');
      await waitForDashboardFrame(
        output,
        () => rendered,
        (text) => inventoryFrameReady(text) && !text.includes('NEW VERSION AVAILABLE'),
        'inventory after choosing Later',
      );
      assert.equal(requests, 0);
      input.write('q');
    } else if (decision === 'keyboard') {
      input.write('u');
    } else {
      const lines = frame.split('\n');
      const row = lines.findIndex((line) => line.includes('UPDATE │'));
      const column = lines[row].indexOf('UPDATE │');
      input.write(`\x1b[<0;${column + 1};${row + 1}M\x1b[<0;${column + 1};${row + 1}m`);
    }
    assert.equal(await done, true);
    assert.equal(requests, decision === 'later' ? 0 : 1);
  } finally {
    input.destroy();
    try {
      await done;
    } finally {
      output.destroy();
      if (previousVersion === undefined) delete process.env.KITIA_INSTALLED_VERSION;
      else process.env.KITIA_INSTALLED_VERSION = previousVersion;
      global.fetch = previousFetch;
    }
  }
}

for (const decision of ['later', 'keyboard', 'mouse']) {
  test(`dashboard version notice handles ${decision}`, { timeout: 8_000 }, () => exerciseVersionNotice(decision));
}
