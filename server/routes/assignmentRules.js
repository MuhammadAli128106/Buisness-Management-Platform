'use strict';
/**
 * Assignment & escalation rules (F3.3 / F3.5) — owner: Ali. Mounted at /api/v1.
 * All timers are in SECONDS so they can be demoed live.
 */
const express = require('express');
const { z } = require('zod');
const { withTransaction } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { audit } = require('../utils/audit');
const leadEngine = require('../services/leadEngine');

const router = express.Router();

const FIELDS = ['max_open_leads', 'ack_window_seconds', 'escalation', 'idle_seconds', 'on_absence_acknowledged'];

function publicRules(r) {
  const out = {};
  for (const k of FIELDS) out[k] = r[k];
  out.updated_at = r.updated_at;
  return out;
}

router.get('/assignment-rules', async (req, res, next) => {
  try {
    const rules = await leadEngine.getRules(req.user.ws);
    res.json({ data: publicRules(rules) });
  } catch (err) { next(err); }
});

const seconds = z.number().int().min(5, 'At least 5 seconds').max(86400, 'At most 24 hours');
const rulesBody = z.object({
  max_open_leads: z.number().int().min(1).max(1000).optional(),
  ack_window_seconds: seconds.optional(),
  escalation: z.array(z.object({
    to: z.enum(['next', 'backup', 'manager']),
    seconds,
  })).min(1, 'Keep at least one escalation level').max(6).optional(),
  idle_seconds: z.number().int().min(30).max(30 * 86400).optional(),
  on_absence_acknowledged: z.enum(['keep', 'reassign']).optional(),
});

router.put('/assignment-rules', requirePerm('rules.manage'), validate({ body: rulesBody }), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const updated = await withTransaction(async (c) => {
      await c.query('INSERT INTO assignment_rules (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING', [ws]);
      const { rows: [before] } = await c.query('SELECT * FROM assignment_rules WHERE workspace_id = $1 FOR UPDATE', [ws]);
      const next = Object.assign({}, before);
      for (const k of FIELDS) if (req.body[k] !== undefined) next[k] = req.body[k];
      const { rows: [after] } = await c.query(
        `UPDATE assignment_rules
            SET max_open_leads = $2, ack_window_seconds = $3, escalation = $4::jsonb,
                idle_seconds = $5, on_absence_acknowledged = $6, updated_at = now()
          WHERE workspace_id = $1 RETURNING *`,
        [ws, next.max_open_leads, next.ack_window_seconds, JSON.stringify(next.escalation),
          next.idle_seconds, next.on_absence_acknowledged]
      );
      await audit(req, {
        ws, event_type: 'rules.updated', target_type: 'assignment_rules', target_id: ws,
        before: publicRules(before), after: publicRules(after),
      }, c);
      return after;
    });
    res.json({ data: publicRules(updated) });
  } catch (err) { next(err); }
});

module.exports = router;
