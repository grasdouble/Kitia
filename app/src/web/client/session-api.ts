async function sessionJson<T>(
  url: string,
  token: string,
  method: 'GET' | 'POST',
  signal?: AbortSignal,
  body?: object,
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { method, headers, signal, body: body ? JSON.stringify(body) : undefined });
  if (response.status === 401) throw new Error('This session has expired. Open the current URL printed by kitia web.');
  if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
  return response.json();
}

export function readSessionJson<T>(url: string, token: string, signal: AbortSignal): Promise<T> {
  return sessionJson<T>(url, token, 'GET', signal);
}

export function postSessionJson<T>(url: string, token: string, body?: object): Promise<T> {
  return sessionJson<T>(url, token, 'POST', undefined, body);
}
