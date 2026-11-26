'use strict';

const childProcess = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');

const root = process.env.KITIA_TEST_UPDATE_ROOT;
const dist = process.env.KITIA_TEST_UPDATE_DIST;
if (process.env.KITIA_TEST_MIGRATABLE) {
  require(path.join(dist, 'core/inventory/version.js')).CURRENT_INVENTORY_VERSION = 2;
}

globalThis.fetch = async (url) => {
  if (url !== 'https://registry.npmjs.org/@grasdouble%2Fkitia/latest') throw new Error(`Unexpected fetch: ${url}`);
  return new Response(JSON.stringify({ version: '999.1.2' }));
};

function managerArguments(file, args) {
  return process.platform === 'win32' && args[0] === '/d' && args[1] === '/c' ? args[2].split(' ') : [file, ...args];
}

const execFile = childProcess.execFile;
const execAsync = execFile[promisify.custom];
childProcess.execFile = (...args) => execFile(...args);
Object.defineProperty(childProcess.execFile, promisify.custom, {
  value(file, args, options) {
    const command = managerArguments(file, args).join(' ');
    if (command === 'npm root --global') return Promise.resolve({ stdout: root || '', stderr: '' });
    if (command.startsWith('pnpm ')) return Promise.resolve({ stdout: '[]', stderr: '' });
    return execAsync(file, args, options);
  },
});

let port;
const createServer = http.createServer;
http.createServer = (...args) => {
  const server = createServer(...args);
  server.once('listening', () => {
    port = server.address().port;
  });
  return server;
};

const spawn = childProcess.spawn;
childProcess.spawn = (file, args, options) => {
  if (managerArguments(file, args).join(' ') !== 'npm install --global @grasdouble/kitia@latest')
    return spawn(file, args, options);
  const probe = `
    const fs = require('node:fs');
    const net = require('node:net');
    const [port, report] = process.argv.slice(1);
    const socket = net.connect(Number(port), '127.0.0.1');
    socket.once('connect', () => { fs.writeFileSync(report, 'OPEN'); socket.destroy(); process.exitCode = 1; });
    socket.once('error', (error) => { fs.writeFileSync(report, error.code); if (error.code !== 'ECONNREFUSED') process.exitCode = 1; });
  `;
  return spawn(process.execPath, ['-e', probe, String(port), process.env.KITIA_TEST_UPDATE_REPORT], options);
};
