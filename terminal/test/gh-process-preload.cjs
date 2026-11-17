"use strict";

const childProcess = require("node:child_process");
const originalSpawn = childProcess.spawn;
const originalSpawnSync = childProcess.spawnSync;
const originalExecFile = childProcess.execFile;
const originalExecFileSync = childProcess.execFileSync;

function redirect(command, args = []) {
  if (command !== "gh") return [command, args];
  const fixture = process.env.KITIA_TEST_GH_SCRIPT;
  if (!fixture) throw new Error("KITIA_TEST_GH_SCRIPT must identify the isolated GitHub fixture");
  return [process.execPath, [fixture, ...args]];
}

childProcess.spawn = (command, args, options) => originalSpawn(...redirect(command, args), options);
childProcess.spawnSync = (command, args, options) => originalSpawnSync(...redirect(command, args), options);
childProcess.execFileSync = (command, args, options) => originalExecFileSync(...redirect(command, args), options);
childProcess.execFile = (command, args, options, callback) => {
  if (typeof args === "function") {
    callback = args;
    args = [];
    options = undefined;
  } else if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  return originalExecFile(...redirect(command, args), options, callback);
};
