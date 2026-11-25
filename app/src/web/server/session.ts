import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';

import type { InstalledResourceSelector } from '../../application/inventory-preview.js';
import type { InstallationTargets, InventoryWorkspace } from '../../application/snapshot.js';
import { runOperation } from '../../application/worker-client.js';

const host = '127.0.0.1';
const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function sendJson(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function resolveDirectory(directory: string) {
  const resolved = await realpath(directory);
  if (!(await stat(resolved)).isDirectory()) throw new Error(`Not a directory: ${directory}`);
  return resolved;
}

const previewRoute = '/api/inventory/preview?';
function installedSelector(query: string): InstalledResourceSelector | undefined {
  const params = new URLSearchParams(query);
  if (params.size !== 5) return undefined;
  const scope = params.get('scope');
  const kind = params.get('kind');
  const id = params.get('id');
  const catalog = params.get('catalog');
  const managed = params.get('managed');
  if (
    (scope !== 'project' && scope !== 'user') ||
    (kind !== 'skill' && kind !== 'agent' && kind !== 'instruction') ||
    !id ||
    catalog === null ||
    (managed !== 'true' && managed !== 'false')
  )
    return undefined;
  return { scope, kind, id, catalog, managed: managed === 'true' };
}

export async function startWebSession(requestedTargets: InstallationTargets) {
  const targets = {
    project: await resolveDirectory(requestedTargets.project),
    user: await resolveDirectory(requestedTargets.user),
  };
  const client = path.join(__dirname, '../client');
  const assets = new Map<string, { type: string; body: Buffer }>();
  assets.set('/', { type: 'text/html; charset=utf-8', body: await readFile(path.join(client, 'index.html')) });
  for (const name of await readdir(path.join(client, 'assets'))) {
    if (!/^[\w.-]+\.(?:js|css)$/.test(name)) continue;
    assets.set(`/assets/${name}`, {
      type: name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
      body: await readFile(path.join(client, 'assets', name)),
    });
  }
  const token = randomBytes(32).toString('base64url');
  const credentials = Buffer.from(`Bearer ${token}`);
  let origin: string;
  let authority: string;
  let inventoryRead: Promise<InventoryWorkspace> | undefined;
  const server = createServer(async (request, response) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    if (request.headers.host !== authority) {
      sendJson(response, 403, { error: 'Invalid host.' });
      return;
    }
    if (request.headers.origin !== undefined && request.headers.origin !== origin) {
      sendJson(response, 403, { error: 'Invalid origin.' });
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    const route = request.url || '/';
    const asset = assets.get(route);
    if (asset) {
      response.writeHead(200, { 'Content-Type': asset.type });
      response.end(asset.body);
      return;
    }
    if (route !== '/api/inventory' && !route.startsWith(previewRoute)) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite !== undefined && fetchSite !== 'same-origin') {
      sendJson(response, 403, { error: 'Inventory requests must come from this session.' });
      return;
    }
    const supplied = Buffer.from(request.headers.authorization || '');
    if (supplied.length !== credentials.length || !timingSafeEqual(supplied, credentials)) {
      sendJson(response, 401, { error: 'Invalid session.' });
      return;
    }
    try {
      if (route === '/api/inventory') {
        inventoryRead ??= runOperation({ task: 'inventory-read', targets }).finally(() => {
          inventoryRead = undefined;
        });
        sendJson(response, 200, { targets, ...(await inventoryRead) });
        return;
      }
      const selector = installedSelector(route.slice(previewRoute.length));
      if (!selector) {
        sendJson(response, 400, { error: 'Invalid installed resource selector.' });
        return;
      }
      const inspection = await runOperation({ task: 'inventory-preview', targets, selector });
      if (inspection) sendJson(response, 200, inspection);
      else sendJson(response, 404, { error: 'This resource is not available for local preview.' });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : 'Could not read the inventory.' });
    }
  });

  const listening = once(server, 'listening');
  server.listen(0, host);
  await listening;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not resolve the local web address.');
  authority = `${host}:${address.port}`;
  origin = `http://${authority}`;
  return { server, url: `${origin}/#session=${token}` };
}
