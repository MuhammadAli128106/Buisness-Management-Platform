// requireAuth loads the user + effective permissions from the DB on every request,
// so permission changes and deactivations take effect immediately (F1.3, F1.5).
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../utils/jwtSecret');
const { getTokenFromRequest } = require('../utils/sessionCookie');
const { queryOne } = require('../db/index');
const { ALL_PERMISSIONS } = require('../utils/permissions');

async function loadUser(id, ws) {
  const row = await queryOne(
    `SELECT u.id, u.workspace_id, u.name, u.email, u.level, u.role_id, u.status, u.timezone, u.prefs,
            r.name AS role_name, COALESCE(r.permissions, '{}') AS role_permissions,
            w.name AS workspace_name, w.slug AS workspace_slug
       FROM users u JOIN workspaces w ON w.id = u.workspace_id
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1 AND u.workspace_id = $2 AND u.is_active`,
    [id, ws],
  );
  if (!row) return null;
  return {
    id: row.id, ws: row.workspace_id, name: row.name, email: row.email, level: row.level,
    role_id: row.role_id, role_name: row.role_name, status: row.status, timezone: row.timezone, prefs: row.prefs,
    permissions: row.level === 'owner' ? [...ALL_PERMISSIONS] : row.role_permissions,
    workspace: { id: row.workspace_id, name: row.workspace_name, slug: row.workspace_slug },
  };
}

async function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  let payload;
  try { payload = jwt.verify(token, getJwtSecret()); } catch { return res.status(401).json({ error: 'Your session expired. Please log in again.' }); }
  try {
    const user = await loadUser(payload.id, payload.ws);
    if (!user) return res.status(401).json({ error: 'Your account is no longer active.' });
    req.user = user;
    next();
  } catch (e) { next(e); }
}

const hasPerm = (req, key) => req.user?.level === 'owner' || Boolean(req.user?.permissions?.includes(key));

/** requirePerm('crm.edit', ...) — all listed keys required. */
function requirePerm(...keys) {
  return (req, res, next) => {
    const missing = keys.find((k) => !hasPerm(req, k));
    if (missing) return res.status(403).json({ error: `You need the "${missing}" permission to do this` });
    next();
  };
}

module.exports = { requireAuth, requirePerm, hasPerm, loadUser };
