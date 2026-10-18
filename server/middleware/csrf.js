const { validateCsrf, hasSessionCookie } = require('../utils/csrf');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT = /\/api\/v1\/auth\/(login|signup|refresh|logout)\/?$/;

/** Mutating requests carrying a session cookie must echo the CSRF cookie in x-csrf-token. */
function requireCsrf(req, res, next) {
  if (SAFE.has(req.method)) return next();
  if (EXEMPT.test(req.originalUrl.split('?')[0])) return next();
  if (!hasSessionCookie(req)) return next(); // no cookie → no ambient authority to forge
  if (!validateCsrf(req)) return res.status(403).json({ error: 'Your session security token is missing or stale. Reload the page and try again.' });
  next();
}
module.exports = { requireCsrf };
