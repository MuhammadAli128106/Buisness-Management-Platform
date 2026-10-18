'use strict';
/**
 * Employee availability (F3.2 / F3.6) — owner: Ali. Mounted at /api/v1.
 *   PATCH /me/status        { status }   — anyone, for themselves
 *   PATCH /users/:id/status { status }   — users.manage OR leads.reassign
 */
const express = require('express');
const { z } = require('zod');
const { hasPerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const leadEngine = require('../services/leadEngine');

const router = express.Router();
const statusBody = z.object({ status: z.enum(['available', 'busy', 'on_leave', 'offline']) });

function explain(result) {
  if (result.status !== 'on_leave' && result.status !== 'offline') return null;
  const parts = [];
  parts.push(`${result.reassigned} unacknowledged lead(s) moved to colleagues`);
  if (result.unassigned) parts.push(`${result.unassigned} sent to the recovery queue (nobody available)`);
  if (result.policy === 'keep' && result.kept) parts.push(`${result.kept} acknowledged lead(s) stay with you (workspace rule: keep)`);
  if (result.policy === 'reassign') parts.push('acknowledged leads were moved too (workspace rule: reassign)');
  return parts.join('; ');
}

async function change(req, res, next, userId) {
  try {
    const result = await leadEngine.onStatusChange({
      ws: req.user.ws, userId, status: req.body.status, actorId: req.user.id, req,
    });
    res.json({ data: Object.assign({}, result, { message: explain(result) }) });
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

router.patch('/me/status', validate({ body: statusBody }), (req, res, next) => change(req, res, next, req.user.id));

router.patch('/users/:id/status',
  validate({ params: z.object({ id: z.string().uuid() }), body: statusBody }),
  (req, res, next) => {
    if (req.params.id !== req.user.id && !hasPerm(req, 'users.manage') && !hasPerm(req, 'leads.reassign')) {
      return res.status(403).json({ error: 'You need the "users.manage" or "leads.reassign" permission to do this' });
    }
    return change(req, res, next, req.params.id);
  });

module.exports = router;
