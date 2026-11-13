export * from 'url/';
export function fileURLToPath(value) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== 'file:') throw new TypeError('Expected a file URL');
  if (url.hostname && url.hostname !== 'localhost') throw new TypeError('Remote file URLs are unavailable in the browser demo');
  return decodeURIComponent(url.pathname);
}
