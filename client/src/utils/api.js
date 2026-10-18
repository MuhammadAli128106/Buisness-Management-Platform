// API helper — owner: Musa. Same-origin /api/v1; cookies carry the session; CSRF header added automatically;
// a 401 triggers one silent refresh then a retry. Every helper throws Error(serverMessage) with .status/.details.
import { csrfHeaders } from './csrf';
import { refreshSession } from './tokenRefresh';
import { handleUnauthorized } from './authSession';

export const API_BASE = '/api/v1';

async function raw(path, options = {}, retried = false) {
  const method = (options.method || 'GET').toUpperCase();
  const isForm = options.body instanceof FormData;
  const headers = {
    ...(options.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
    ...csrfHeaders(method),
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options, method, headers });
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refreshSession()) return raw(path, options, true);
    handleUnauthorized();
  }
  return res;
}

export async function apiFetch(path, options = {}) {
  const res = await raw(path, {
    ...options,
    body: options.body !== undefined && !(options.body instanceof FormData) && typeof options.body !== 'string'
      ? JSON.stringify(options.body) : options.body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.status = res.status; err.details = json.details; err.body = json;
    throw err;
  }
  return json;
}

/** GET → full JSON body ({data, total, ...}). Also the SWR fetcher: useSWR('/contacts', apiGet). */
export const apiGet = (path) => apiFetch(path);
export const apiPost = (path, body) => apiFetch(path, { method: 'POST', body: body ?? {} });
export const apiPatch = (path, body) => apiFetch(path, { method: 'PATCH', body: body ?? {} });
export const apiPut = (path, body) => apiFetch(path, { method: 'PUT', body: body ?? {} });
export const apiDelete = (path) => apiFetch(path, { method: 'DELETE' });

/** Build "?a=1&b=2" from an object, skipping empty values. */
export function qs(params = {}) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') sp.set(k, v); });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Download a CSV export with cookies (F1.4: server masks values). */
export async function downloadFile(path, filename) {
  const res = await raw(path);
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Download failed'); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
