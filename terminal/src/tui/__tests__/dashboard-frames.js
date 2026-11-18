'use strict';

const assert = require('node:assert/strict');

function waitForOutput(output, getValue, predicate, description, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let timeout;
    let checking = false;
    let dirty = false;
    const cleanup = () => {
      clearTimeout(timeout);
      output.off('data', onData);
      output.off('end', onEnd);
      output.off('close', onClose);
      output.off('error', onError);
    };
    const check = () => {
      const value = getValue();
      if (predicate(value)) {
        cleanup();
        resolve(value);
        return;
      }
      if (checking) {
        dirty = true;
        return;
      }
      checking = true;
      dirty = false;
      queueMicrotask(() => {
        checking = false;
        if (dirty) check();
      });
    };
    const onData = () => {
      check();
    };
    const onEnd = () => {
      cleanup();
      reject(new Error(`Output ended before ${description}`));
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Output closed before ${description}`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    output.on('data', onData);
    output.once('end', onEnd);
    output.once('close', onClose);
    output.once('error', onError);
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${description}: ${String(getValue()).slice(-1000)}`));
    }, timeoutMs);
    check();
  });
}

function selectedDetailsFrame(rendered) {
  const end = rendered.lastIndexOf('\u001b[?2026l');
  const start = rendered.lastIndexOf('\u001b[?2026h', end);
  return start >= 0 && end > start ? require('node:util').stripVTControlCharacters(rendered.slice(start, end)) : '';
}

function waitForDashboardFrame(output, getRendered, predicate, description, start = 0) {
  return waitForOutput(
    output,
    () => selectedDetailsFrame(getRendered().slice(start)),
    (frame) => Boolean(frame) && predicate(frame),
    description,
    3_000,
  );
}

function selectedListRow(frame) {
  return frame.match(/^[ \t]*│[ \t]*›[ \t]+([^\s│]+)/m)?.[1];
}

function inventoryFrameReady(frame) {
  return frame.includes('INVENTORY') && frame.includes('Q quit');
}

function browseFrameReady(frame) {
  return frame.includes('INSTALL FROM CATALOG') && frame.includes('P preview/audit') && frame.includes('Q quit');
}

function detailBodyText(frame) {
  const lines = frame.split(/\r?\n/);
  const header = lines.findIndex((line) => /[│]\s*SELECTION(?: [A-Z]+\.\.\.| DETAILS|\.\.\.)/.test(line));
  if (header < 0) return '';
  const left = lines[header].lastIndexOf('│', lines[header].indexOf('SELECTION'));
  const details = [];
  for (const line of lines.slice(header + 1)) {
    if (line.includes('└')) break;
    const border = /[│┼]/.test(line[left]) ? left : -1;
    const start = border < 0 ? left + 1 : border + 1;
    const end = line.indexOf('│', start);
    details.push(line.slice(start, end < 0 ? undefined : end));
  }
  return details.join('').replace(/[\s┌┐└┘─│]/g, '');
}

function assertSeparatedPanelHeader(frame, title, firstBody, metadata = []) {
  const lines = frame.split(/\r?\n/);
  const titleRow = lines.findIndex((line) => {
    const column = line.indexOf(title);
    return column >= 2 && line[column - 2] === '│';
  });
  assert.ok(titleRow >= 0, `panel title ${title} is visible inside its frame`);
  const column = lines[titleRow].indexOf(title);
  const contentAt = (row) => lines[row]?.slice(column).split('│', 1)[0].trimEnd();
  for (const [offset, expected] of metadata.entries()) {
    const content = contentAt(titleRow + offset + 1);
    assert.ok(content !== undefined, `${title} metadata row ${offset + 1} remains visible`);
    if (expected instanceof RegExp) assert.match(content, expected);
    else assert.equal(content, expected, `${title} preserves its metadata text and order`);
  }
  const dividerRow = titleRow + metadata.length + 1;
  assert.match(lines[dividerRow].slice(column), /^─+\s*│/, `one divider follows ${title} and all its metadata`);
  assert.ok(
    contentAt(dividerRow + 1)
      ?.trimStart()
      .startsWith(firstBody),
    `${title} content starts immediately below the divider`,
  );
  const body = [];
  for (const line of lines.slice(dividerRow + 1)) {
    if (line[column - 2] !== '│') break;
    const content = line.slice(column).split('│', 1)[0].trimEnd();
    assert.doesNotMatch(content, /^─+$/, `${title} has no duplicate divider`);
    body.push(content);
  }
  return body;
}

module.exports = {
  waitForOutput,
  selectedDetailsFrame,
  waitForDashboardFrame,
  selectedListRow,
  inventoryFrameReady,
  browseFrameReady,
  detailBodyText,
  assertSeparatedPanelHeader,
};
