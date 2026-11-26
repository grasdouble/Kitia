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

export async function runSessionMutation<T>(
  url: string,
  token: string,
  onProgress: (message: string) => void,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/x-ndjson' },
  });
  if (response.status === 401) throw new Error('This session has expired. Open the current URL printed by kitia web.');
  if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
  if (!response.headers.get('content-type')?.startsWith('application/x-ndjson')) return response.json();
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += value;
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) {
        const event = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        if ('result' in event) return event.result;
        if ('error' in event) throw new Error(event.error);
        if (typeof event.progress === 'string') onProgress(event.progress);
      }
    }
  } finally {
    reader?.releaseLock();
  }
  throw new Error('The connection closed before Kitia reported the outcome. Check the inventory before retrying.');
}
