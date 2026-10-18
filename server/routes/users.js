// Users (F1.2). Status changes are NOT here — Ali owns PATCH /users/:id/status in routes/availability.js.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { queryAll, queryOne, withTransaction } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { isUuid } = require('../utils/dbSecurity');
const { audit, diff } = require('../utils/audit');
const leadEngine = require('../services/leadEngine');

const router = express.Router();

// GET /users — any authenticated user (needed for owner pickers, assignment, booking)
router.get('/', async (req, res, next) => {
  try {
    const rows = await queryAll(
      `SELECT u.id, u.name, u.email, u.level, u.role_id, r.name AS role_name, u.status, u.timezone,
              u.backup_user_id, u.manager_user_id, u.is_active,
              (u.telegram_chat_id IS NOT NULL) AS telegram_connected,
              COALESCE(g.status, 'not_connected') AS calendar_status,
              (SELECT count(*) FROM leads l WHERE l.workspace_id = u.workspace_id AND l.owner_id = u.id
                  AND l.status IN ('assigned','acknowledged'))::int AS open_leads
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN google_tokens g ON g.user_id = u.id
        WHERE u.workspace_id = $1 AND (u.is_active OR $2)
        ORDER BY (u.level = 'owner') DESC, u.name`,
      [req.user.ws, req.query.include_inactive === '1'],
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

router.post('/invite', requirePerm('users.manage'), validate({
  body: z.object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    email: z.string().trim().email('Enter a valid email'),
    level: z.enum(['admin', 'user']),
    role_id: z.string().uuid('Pick a role'),
  }),
}), async (req, res, next) => {
  try {
    if (req.body.level === 'admin' && req.user.level !== 'owner') throw httpError(403, 'Only the Owner can create Admin-level users');
    const role = await queryOne('SELECT id FROM roles WHERE id = $1 AND workspace_id = $2', [req.body.role_id, req.user.ws]);
    if (!role) throw httpError(400, 'Invalid role', { role_id: 'Pick a role from this workspace' });
    const email = req.body.email.toLowerCase();
    if (await queryOne('SELECT 1 FROM users WHERE email = $1', [email])) throw httpError(409, 'A user with this email already exists', { email: 'Already registered' });
    const tempPassword = `Tmp-${crypto.randomBytes(5).toString('hex')}`;
    const user = await queryOne(
      `INSERT INTO users (workspace_id, name, email, password_hash, level, role_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, level, role_id, status`,
      [req.user.ws, req.body.name, email, await bcrypt.hash(tempPassword, 12), req.body.level, req.body.role_id],
    );
    await audit(req, { event_type: 'user.invited', target_type: 'user', target_id: user.id, after: { name: user.name, email, level: user.level, role_id: user.role_id } });
    res.status(201).json({ data: user, temp_password: tempPassword });
  } catch (e) { next(e); }
});

router.patch('/:id', requirePerm('users.manage'), validate({
  body: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    level: z.enum(['admin', 'user']).optional(),
    role_id: z.string().uuid().nullable().optional(),
    backup_user_id: z.string().uuid().nullable().optional(),
    manager_user_id: z.string().uuid().nullable().optional(),
    timezone: z.string().max(60).optional(),
    is_active: z.boolean().optional(),
  }),
}), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) throw httpError(404, 'Not found');
    const target = await queryOne('SELECT * FROM users WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user.ws]);
    if (!target) throw httpError(404, 'Not found');
    if (target.level === 'owner' && req.user.level !== 'owner') throw httpError(403, 'Admins cannot modify the Owner');
    if (target.level === 'owner' && (req.body.level || req.body.is_active === false)) throw httpError(400, 'The Owner cannot be re-levelled or deactivated');
    if (req.body.level === 'admin' && req.user.level !== 'owner') throw httpError(403, 'Only the Owner can grant Admin level');
    if (req.body.is_active === false && target.id === req.user.id) throw httpError(400, 'You cannot deactivate yourself');
    for (const k of ['role_id']) {
      if (req.body[k] && !await queryOne('SELECT 1 FROM roles WHERE id = $1 AND workspace_id = $2', [req.body[k], req.user.ws])) throw httpError(400, 'Invalid role');
    }
    for (const k of ['backup_user_id', 'manager_user_id']) {
      if (req.body[k] === target.id) throw httpError(400, 'A user cannot be their own backup or manager');
      if (req.body[k] && !await queryOne('SELECT 1 FROM users WHERE id = $1 AND workspace_id = $2', [req.body[k], req.user.ws])) throw httpError(400, 'Invalid user reference');
    }
    const keys = Object.keys(req.body);
    if (!keys.length) return res.json({ data: target });
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const updated = await withTransaction(async (c) => {
      const u = (await c.query(
        `UPDATE users SET ${sets}, updated_at = now() WHERE id = $1 AND workspace_id = $2
         RETURNING id, name, email, level, role_id, status, backup_user_id, manager_user_id, timezone, is_active`,
        [target.id, req.user.ws, ...keys.map((k) => req.body[k])],
      )).rows[0];
      const d = diff(target, u, keys);
      if (d.changed) {
        await audit(req, {
          event_type: req.body.is_active === false ? 'user.deactivated' : 'user.updated',
          target_type: 'user', target_id: u.id, before: d.before, after: d.after,
        }, c);
      }
      return u;
    });
    if (req.body.is_active === false) {
      await leadEngine.onStatusChange({ ws: req.user.ws, userId: target.id, status: 'offline', actorId: req.user.id });
    }
    res.json({ data: updated });
  } catch (e) { next(e); }
});

module.exports = router;
