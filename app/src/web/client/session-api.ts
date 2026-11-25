export async function readSessionJson<T>(url: string, token: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (response.status === 401) throw new Error('This session has expired. Open the current URL printed by kitia web.');
  if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
  return response.json();
}
