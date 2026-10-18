// Roles = named permission sets (F1.3). Manager is just a role.
const express = require('express');
const { z } = require('zod');
const { queryAll, queryOne } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { isUuid } = require('../utils/dbSecurity');
const { audit } = require('../utils/audit');
const { ALL_PERMISSIONS, PERMISSION_LABELS, DEFAULT_ROLES } = require('../utils/permissions');

const router = express.Router();
const permArray = z.array(z.enum(ALL_PERMISSIONS)).max(ALL_PERMISSIONS.length);

router.get('/', async (req, res, next) => {
  try {
    // Self-repair: a workspace with no roles at all (e.g. created mid-reseed) gets the signup defaults back,
    // otherwise nobody can be invited. ON CONFLICT keeps this safe if two requests race.
    const { n } = await queryOne('SELECT count(*)::int AS n FROM roles WHERE workspace_id = $1', [req.user.ws]);
    if (n === 0) {
      for (const [roleName, perms] of Object.entries(DEFAULT_ROLES)) {
        // eslint-disable-next-line no-await-in-loop
        await queryOne(
          'INSERT INTO roles (workspace_id, name, permissions) VALUES ($1,$2,$3) ON CONFLICT (workspace_id, name) DO NOTHING RETURNING id',
          [req.user.ws, roleName, perms],
        );
      }
      await audit(null, { ws: req.user.ws, event_type: 'role.created', target_type: 'role', after: { restored_defaults: Object.keys(DEFAULT_ROLES) } });
    }
    const rows = await queryAll(
      `SELECT r.*, (SELECT count(*) FROM users u WHERE u.role_id = r.id AND u.is_active)::int AS user_count
         FROM roles r WHERE r.workspace_id = $1 ORDER BY r.created_at`, [req.user.ws],
    );
    res.json({ data: rows, permissions: ALL_PERMISSIONS.map((key) => ({ key, label: PERMISSION_LABELS[key] })) });
  } catch (e) { next(e); }
});

router.post('/', requirePerm('users.manage'), validate({
  body: z.object({ name: z.string().trim().min(1, 'Name is required').max(60), permissions: permArray.default([]) }),
}), async (req, res, next) => {
  try {
    const role = await queryOne(
      'INSERT INTO roles (workspace_id, name, permissions) VALUES ($1,$2,$3) RETURNING *',
      [req.user.ws, req.body.name, req.body.permissions],
    );
    await audit(req, { event_type: 'role.created', target_type: 'role', target_id: role.id, after: { name: role.name, permissions: role.permissions } });
    res.status(201).json({ data: role });
  } catch (e) { next(e); }
});

router.patch('/:id', requirePerm('users.manage'), validate({
  body: z.object({ name: z.string().trim().min(1).max(60).optional(), permissions: permArray.optional() }),
}), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) throw httpError(404, 'Not found');
    const before = await queryOne('SELECT * FROM roles WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user.ws]);
    if (!before) throw httpError(404, 'Not found');
    const role = await queryOne(
      `UPDATE roles SET name = COALESCE($3, name), permissions = COALESCE($4, permissions)
        WHERE id = $1 AND workspace_id = $2 RETURNING *`,
      [before.id, req.user.ws, req.body.name ?? null, req.body.permissions ?? null],
    );
    await audit(req, {
      event_type: 'role.permissions_changed', target_type: 'role', target_id: role.id,
      before: { name: before.name, permissions: before.permissions }, after: { name: role.name, permissions: role.permissions },
    });
    res.json({ data: role });
  } catch (e) { next(e); }
});

module.exports = router;
