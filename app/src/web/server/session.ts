import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';

import type { CatalogResourceSelector } from '../../application/catalog-preview.js';
import type { InventoryMutation, InventoryMutationRetry } from '../../application/inventory-mutation.js';
import type { InstalledResourceSelector } from '../../application/inventory-preview.js';
import type { InstallationTargets, InventoryWorkspace } from '../../application/snapshot.js';
import { runOperation } from '../../application/worker-client.js';
import {
  installationDestinationIds,
  isInstallationDestination,
  type InstallationDestination,
} from '../../core/installations/destinations.js';
import { readCatalogCommand, runCatalogCommand } from './catalog-management.js';

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

const localPreviewRoute = '/api/inventory/preview?';
const catalogPreviewRoute = '/api/catalog/preview?';
const catalogRevisionsRoute = '/api/catalog/revisions?';
const catalogInstallRoute = '/api/catalog/install?';
const inventoryActionRoute = '/api/inventory/action?';
const inventoryActions: readonly InventoryMutation[] = ['update', 'uninstall', 'remove-unmanaged'];

function resourceIdentity(params: URLSearchParams) {
  const catalog = params.get('catalog');
  const kind = params.get('kind');
  const id = params.get('id');
  if (catalog === null || !id || (kind !== 'skill' && kind !== 'agent' && kind !== 'instruction')) return undefined;
  return { catalog, kind, id } as const;
}

function installedSelector(params: URLSearchParams): InstalledResourceSelector | undefined {
  const identity = resourceIdentity(params);
  const scope = params.get('scope');
  const managed = params.get('managed');
  if (!identity || (scope !== 'project' && scope !== 'user') || (managed !== 'true' && managed !== 'false'))
    return undefined;
  return { ...identity, scope, managed: managed === 'true' };
}

function catalogSelector(params: URLSearchParams): CatalogResourceSelector | undefined {
  const identity = resourceIdentity(params);
  const ref = params.get('ref');
  if (!identity?.catalog || !ref || !/^[a-f0-9]{40}$/i.test(ref)) return undefined;
  return { ...identity, ref };
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
  const retries = new Map<
    string,
    {
      ticket: string;
      key: string;
      stamp: string;
      destination: InstallationDestination;
      attempted: ReadonlySet<InstallationDestination>;
    }
  >();
  let catalogWrite = false;
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
    const route = request.url || '/';
    const isCatalogInstall = route === '/api/catalog/install' || route.startsWith(catalogInstallRoute);
    const isInventoryAction = route.startsWith(inventoryActionRoute);
    const isCatalogManagement = route === '/api/catalog/manage';
    const mutation = isCatalogInstall || isCatalogManagement || (isInventoryAction && request.method === 'POST');
    const method = mutation ? 'POST' : 'GET';
    if (request.method !== method) {
      response.setHeader('Allow', isInventoryAction ? 'GET, POST' : method);
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    if (mutation && request.headers.origin !== origin) {
      sendJson(response, 403, { error: 'Write requests must come from this session.' });
      return;
    }
    const asset = assets.get(route);
    if (asset) {
      response.writeHead(200, { 'Content-Type': asset.type });
      response.end(asset.body);
      return;
    }
    const isLocalPreview = route.startsWith(localPreviewRoute);
    const isCatalogPreview = route.startsWith(catalogPreviewRoute);
    const isCatalogRevisions = route.startsWith(catalogRevisionsRoute);
    if (
      !(
        route === '/api/inventory' ||
        route === '/api/catalog' ||
        route === '/api/catalog/freshness' ||
        route === '/api/catalog/export' ||
        isCatalogManagement ||
        isLocalPreview ||
        isCatalogPreview ||
        isCatalogRevisions ||
        isInventoryAction ||
        isCatalogInstall
      )
    ) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite !== undefined && fetchSite !== 'same-origin') {
      sendJson(response, 403, { error: 'API requests must come from this session.' });
      return;
    }
    const supplied = Buffer.from(request.headers.authorization || '');
    if (supplied.length !== credentials.length || !timingSafeEqual(supplied, credentials)) {
      sendJson(response, 401, { error: 'Invalid session.' });
      return;
    }
    try {
      if (isInventoryAction) {
        const params = new URLSearchParams(route.slice(inventoryActionRoute.length));
        const selector = installedSelector(params);
        const action = inventoryActions.find((value) => value === params.get('action'));
        const stamp = params.get('stamp') ?? '';
        const retry = params.get('retry');
        const revision = params.get('revision')?.toLowerCase();
        if (
          !selector ||
          !action ||
          (action === 'remove-unmanaged') === selector.managed ||
          (revision !== undefined && (action !== 'update' || !/^[a-f0-9]{40}$/.test(revision))) ||
          params.size !== (mutation ? 7 + Number(retry !== null) : 6) + Number(revision !== undefined) ||
          (mutation ? !/^[a-f0-9]{64}$/.test(stamp) : stamp !== '' || retry !== null)
        ) {
          sendJson(response, 400, { error: 'Invalid inventory action selector.' });
          return;
        }
        const reviewTask = { task: 'inventory-review', targets, action, selector, revision } as const;
        if (!mutation) {
          sendJson(response, 200, await runOperation(reviewTask));
          return;
        }
        const key = JSON.stringify(selector);
        const previous = retries.get(selector.scope);
        if (
          retry !== null &&
          (action !== 'update' ||
            !previous ||
            previous.ticket !== retry ||
            previous.key !== key ||
            previous.stamp !== stamp)
        ) {
          sendJson(response, 409, { error: 'This retry is no longer available. Review the update again.' });
          return;
        }
        retries.delete(selector.scope);
        const destination = retry === null ? undefined : previous?.destination;
        const attempted = new Set(retry === null ? undefined : previous?.attempted);
        if (destination) attempted.add(destination);
        const selection = { selector, stamp, revision };
        const initial = action === 'update' ? await runOperation(reviewTask) : undefined;
        const result = await runOperation({
          task: 'inventory-mutate',
          targets,
          action,
          selection,
          options: destination ? { ghForce: true, ghForceAgent: destination } : undefined,
        });
        const failure = result.failure;
        if (
          action === 'update' &&
          failure?.code === 'GH_FORCE_REQUIRED' &&
          failure.recoverable &&
          failure.agent &&
          isInstallationDestination(failure.agent) &&
          !attempted.has(failure.agent)
        ) {
          const review = await runOperation(reviewTask).catch(() => undefined);
          if (review && review.catalogPin === initial?.catalogPin) {
            const ticket = randomBytes(24).toString('base64url');
            retries.set(selector.scope, { ticket, key, stamp: review.stamp, destination: failure.agent, attempted });
            const retry: InventoryMutationRetry = { ticket, review };
            sendJson(response, 200, { ...result, retry });
            return;
          }
        }
        sendJson(response, 200, result);
        return;
      }
      if (isCatalogInstall) {
        const params = new URLSearchParams(route.slice(catalogInstallRoute.length));
        const scope = params.get('scope');
        const destinations = params.getAll('destination').filter(isInstallationDestination);
        const selector = catalogSelector(params);
        const revision = params.get('revision')?.toLowerCase();
        if (
          !selector ||
          (scope !== 'project' && scope !== 'user') ||
          (revision !== undefined && !/^[a-f0-9]{40}$/.test(revision)) ||
          params.size !== 5 + destinations.length + Number(revision !== undefined) ||
          !destinations.length ||
          destinations.length > installationDestinationIds.length ||
          new Set(destinations).size !== destinations.length
        ) {
          sendJson(response, 400, { error: 'Invalid catalog installation options.' });
          return;
        }
        const target = targets[scope];
        if ((await realpath(target)) !== target) {
          sendJson(response, 409, {
            error: 'The installation directory has changed. Restart kitia web from the intended project.',
          });
          return;
        }
        sendJson(
          response,
          200,
          await runOperation({
            task: 'catalog-install',
            selector,
            revision,
            targets,
            options: { scope, destinations },
          }),
        );
        return;
      }
      if (route === '/api/inventory') {
        inventoryRead ??= runOperation({ task: 'inventory-read', targets }).finally(() => {
          inventoryRead = undefined;
        });
        sendJson(response, 200, { targets, ...(await inventoryRead) });
        return;
      }
      if (route === '/api/catalog') {
        sendJson(response, 200, await runOperation({ task: 'catalog-read' }));
        return;
      }
      if (route === '/api/catalog/freshness' || route === '/api/catalog/export') {
        sendJson(
          response,
          200,
          await runOperation({ task: route === '/api/catalog/export' ? 'catalog-export' : 'catalog-freshness' }),
        );
        return;
      }
      if (isCatalogManagement) {
        const command = await readCatalogCommand(request);
        if (catalogWrite) {
          sendJson(response, 409, {
            error: 'Another catalog operation is running. Wait for it to finish before retrying.',
          });
          return;
        }
        catalogWrite = true;
        try {
          sendJson(response, 200, await runCatalogCommand(command));
        } finally {
          catalogWrite = false;
        }
        return;
      }
      if (isLocalPreview) {
        const params = new URLSearchParams(route.slice(localPreviewRoute.length));
        const selector = params.size === 5 ? installedSelector(params) : undefined;
        if (!selector) {
          sendJson(response, 400, { error: 'Invalid installed resource selector.' });
          return;
        }
        const inspection = await runOperation({ task: 'inventory-preview', targets, selector });
        if (inspection) sendJson(response, 200, inspection);
        else sendJson(response, 404, { error: 'This resource is not available for local preview.' });
        return;
      }
      const params = new URLSearchParams(
        route.slice((isCatalogPreview ? catalogPreviewRoute : catalogRevisionsRoute).length),
      );
      const selector = params.size === 4 ? catalogSelector(params) : undefined;
      if (!selector) {
        sendJson(response, 400, { error: 'Invalid pinned resource selector.' });
        return;
      }
      const result = isCatalogPreview
        ? await runOperation({ task: 'catalog-preview', selector, project: targets.project })
        : await runOperation({ task: 'catalog-revisions', selector });
      sendJson(response, 200, result);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      const status =
        code === 'RESOURCE_NOT_FOUND'
          ? 404
          : code === 'STALE_SOURCE'
            ? 409
            : code === 'PAYLOAD_TOO_LARGE'
              ? 413
              : code === 'UNSUPPORTED_MEDIA_TYPE'
                ? 415
                : isCatalogManagement && (code === 'INVALID_ARGUMENT' || code === 'CATALOG_ERROR')
                  ? 400
                  : 500;
      sendJson(response, status, { error: error instanceof Error ? error.message : 'Could not complete the request.' });
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
