// Single-flight session refresh: concurrent 401s share one /auth/refresh call.
let inflight = null;
export function refreshSession() {
  if (!inflight) {
    inflight = fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => { setTimeout(() => { inflight = null; }, 0); });
  }
  return inflight;
}
