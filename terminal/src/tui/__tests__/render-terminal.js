"use strict";

const React = require("react");
const { PassThrough } = require("node:stream");

async function renderTerminal(node, { columns = 80, rows = 24 } = {}) {
  const { render } = await import("ink");
  const output = new PassThrough();
  const input = new PassThrough();
  output.isTTY = true;
  output.columns = columns;
  output.rows = rows;
  let frame = "";
  const write = output.write.bind(output);
  output.write = (chunk, ...args) => {
    frame += chunk.toString();
    return write(chunk, ...args);
  };
  let instance;
  await new Promise((resolve) => {
    instance = render(React.createElement(React.Fragment, null, node), {
      stdout: output,
      stderr: output,
      stdin: input,
      exitOnCtrlC: false,
      onRender: resolve,
    });
  });
  instance.unmount();
  input.destroy();
  output.destroy();
  return frame.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
}

module.exports = { renderTerminal };
