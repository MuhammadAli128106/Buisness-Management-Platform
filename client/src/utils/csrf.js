const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export function getCsrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)bmp_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
export function csrfHeaders(method = 'GET') {
  if (SAFE.has(method.toUpperCase())) return {};
  const t = getCsrfToken();
  return t ? { 'x-csrf-token': t } : {};
}
