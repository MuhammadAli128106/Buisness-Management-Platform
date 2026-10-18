'use strict';
/**
 * /api/v1/leads — owner: Ali (F3.1, F3.4, F3.7). requireAuth is applied globally by Musa.
 */
const express = require('express');
const { z } = require('zod');
const { pool, withTransaction } = require('../db/index');
const { requirePerm, hasPerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { logActivity } = require('../utils/activity');
const leadEngine = require('../services/leadEngine');

const router = express.Router();
const uuid = z.string().uuid();

/** Turn engine errors (err.status) into JSON responses; everything else → errorHandler. */
const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    if (err && err.status && err.status < 500) {
      const body = { error: err.message };
      if (err.current) body.current = err.current;
      return res.status(err.status).json(body);
    }
    return next(err);
  }
};

function pageParams(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}

async function viewerTimezone(req) {
  const { rows } = await pool.query('SELECT timezone FROM users WHERE id = $1', [req.user.id]);
  return (rows[0] && rows[0].timezone) || 'Asia/Karachi';
}

const LIST_SELECT = `
  SELECT l.id, l.contact_id, l.opportunity_id, l.source, l.source_detail, l.owner_id, l.first_owner_id,
         l.status, l.assigned_at, l.first_assigned_at, l.first_ack_at, l.ack_deadline,
         l.escalation_level, l.escalation_count, l.last_action_at, l.version, l.created_at, l.updated_at,
         CASE WHEN l.status = 'assigned' AND l.ack_deadline IS NOT NULL
              THEN FLOOR(EXTRACT(EPOCH FROM (l.ack_deadline - now())))::int END AS seconds_left,
         c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email,
         u.name AS owner_name
    FROM leads l
    JOIN contacts c ON c.id = l.contact_id
    LEFT JOIN users u ON u.id = l.owner_id`;

// GET /leads?scope=mine|all&status=&created=today&escalated=24h&q=&page=&limit=
router.get('/', wrap(async (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  if (scope === 'all' && !hasPerm(req, 'leads.view_all')) {
    return res.status(403).json({ error: 'You need the "leads.view_all" permission to do this' });
  }
  const params = [req.user.ws];
  const where = ['l.workspace_id = $1'];
  if (scope === 'mine') {
    params.push(req.user.id);
    where.push(`l.owner_id = $${params.length}`);
  }
  const statuses = String(req.query.status || '').split(',').filter((s) => ['assigned', 'acknowledged', 'unassigned', 'closed'].includes(s));
  if (statuses.length) {
    params.push(statuses);
    where.push(`l.status = ANY($${params.length}::text[])`);
  } else if (scope === 'mine') {
    where.push(`l.status IN ('assigned','acknowledged')`);
  }
  if (['web_form', 'whatsapp', 'manual'].includes(req.query.source)) {
    params.push(req.query.source);
    where.push(`l.source = $${params.length}`);
  }
  if (req.query.created === 'today') {
    params.push(await viewerTimezone(req));
    where.push(`l.created_at >= (date_trunc('day', now() AT TIME ZONE $${params.length}) AT TIME ZONE $${params.length})`);
  }
  if (req.query.escalated === '24h') {
    where.push(`EXISTS (SELECT 1 FROM lead_assignments a WHERE a.lead_id = l.id AND a.reason = 'escalation'
                        AND a.created_at > now() - interval '24 hours')`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100)}%`);
    where.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.email ILIKE $${params.length})`);
  }
  const { limit, page, offset } = pageParams(req.query);
  const whereSql = where.join(' AND ');
  const countParams = params.slice();
  params.push(limit, offset);
  const [{ rows }, { rows: [{ n }] }] = await Promise.all([
    pool.query(`${LIST_SELECT} WHERE ${whereSql}
                ORDER BY (l.status = 'assigned') DESC, l.ack_deadline ASC NULLS LAST, l.created_at DESC
                LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
    pool.query(`SELECT count(*)::int AS n FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE ${whereSql}`, countParams),
  ]);
  res.json({ data: rows, total: n, page, limit });
}));

// GET /leads/recovery — must stay above /:id
router.get('/recovery', requirePerm('leads.reassign'), wrap(async (req, res) => {
  const result = await leadEngine.listRecovery({ ws: req.user.ws, page: req.query.page, limit: req.query.limit });
  res.json(result);
}));

// GET /leads/:id — owner or leads.view_all
router.get('/:id', validate({ params: z.object({ id: uuid }) }), wrap(async (req, res) => {
  const { rows: [lead] } = await pool.query(`${LIST_SELECT} WHERE l.id = $1 AND l.workspace_id = $2`, [req.params.id, req.user.ws]);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  if (lead.owner_id !== req.user.id && !hasPerm(req, 'leads.view_all') && !hasPerm(req, 'leads.reassign')) {
    return res.status(404).json({ error: 'Not found' });
  }
  const [{ rows: history }, rules] = await Promise.all([
    pool.query(
      `SELECT a.id, a.reason, a.level, a.created_at, a.from_user_id, a.to_user_id, a.actor_id,
              fu.name AS from_name, tu.name AS to_name, au.name AS actor_name
         FROM lead_assignments a
         LEFT JOIN users fu ON fu.id = a.from_user_id
         LEFT JOIN users tu ON tu.id = a.to_user_id
         LEFT JOIN users au ON au.id = a.actor_id
        WHERE a.lead_id = $1 AND a.workspace_id = $2
        ORDER BY a.created_at ASC`,
      [lead.id, req.user.ws]
    ),
    leadEngine.getRules(req.user.ws),
  ]);
  res.json({
    data: Object.assign({}, lead, {
      history,
      on_absence_acknowledged: rules.on_absence_acknowledged,
      can_ack: lead.owner_id === req.user.id && lead.status === 'assigned',
      can_reassign: hasPerm(req, 'leads.reassign'),
    }),
  });
}));

// POST /leads — manual entry (F3.1)
const manualSchema = z.object({
  contact_id: uuid.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
}).refine((b) => b.contact_id || b.name, { message: 'Pick an existing contact or enter a name', path: ['name'] });

router.post('/', requirePerm('crm.create'), validate({ body: manualSchema }), wrap(async (req, res) => {
  const ws = req.user.ws;
  const body = req.body;
  const lead = await withTransaction(async (c) => {
    let contactId = body.contact_id;
    if (contactId) {
      const { rows } = await c.query('SELECT id FROM contacts WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL', [contactId, ws]);
      if (!rows[0]) throw leadEngine.httpError(404, 'Contact not found');
    } else {
      const phone = normalizePhone(body.phone);
      const email = body.email ? body.email.toLowerCase() : null;
      contactId = await findOrCreateContact(c, { ws, name: body.name, phone, email, source: 'manual', createdBy: req.user.id });
    }
    if (body.note) {
      await logActivity({
        ws, contact_id: contactId, opportunity_id: null, lead_id: null, type: 'note',
        actor_id: req.user.id, summary: body.note, data: { via: 'manual_lead' },
      }, c);
    }
    return leadEngine.createLead({
      ws, contactId, source: 'manual', sourceDetail: `Entered by ${req.user.name}`, actorId: req.user.id, client: c, req,
    });
  });
  res.status(201).json({ data: lead });
}));

// POST /leads/:id/ack — current owner only
router.post('/:id/ack', validate({ params: z.object({ id: uuid }) }), wrap(async (req, res) => {
  const lead = await leadEngine.acknowledge({ ws: req.user.ws, leadId: req.params.id, userId: req.user.id, req });
  res.json({ data: lead });
}));

// POST /leads/:id/reassign {user_id, version}
router.post('/:id/reassign', requirePerm('leads.reassign'),
  validate({ params: z.object({ id: uuid }), body: z.object({ user_id: uuid, version: z.number().int().optional() }) }),
  wrap(async (req, res) => {
    const lead = await leadEngine.reassignManual({
      ws: req.user.ws, leadId: req.params.id, toUserId: req.body.user_id, version: req.body.version, req,
    });
    res.json({ data: lead });
  }));

// POST /leads/:id/close — owner or leads.reassign
router.post('/:id/close', validate({ params: z.object({ id: uuid }) }), wrap(async (req, res) => {
  const { rows: [lead] } = await pool.query('SELECT owner_id FROM leads WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user.ws]);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  if (lead.owner_id !== req.user.id && !hasPerm(req, 'leads.reassign')) {
    return res.status(403).json({ error: 'Only the lead owner or someone with "leads.reassign" can close this lead' });
  }
  const updated = await leadEngine.closeLead({ ws: req.user.ws, leadId: req.params.id, req });
  res.json({ data: updated });
}));

// ───────── helpers shared with publicForms.js ─────────
function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).trim().replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (!/^\+?\d{6,15}$/.test(p)) return null;
  return p.startsWith('+') ? p : `+${p}`;
}

/** Match by phone, then email; else create. Race-safe on the (workspace_id, phone) unique index. */
async function findOrCreateContact(c, { ws, name, phone, email, source, createdBy }) {
  if (phone) {
    const { rows } = await c.query('SELECT id FROM contacts WHERE workspace_id = $1 AND phone = $2 AND deleted_at IS NULL', [ws, phone]);
    if (rows[0]) return rows[0].id;
  }
  if (email) {
    const { rows } = await c.query(
      'SELECT id FROM contacts WHERE workspace_id = $1 AND lower(email) = $2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1',
      [ws, email]
    );
    if (rows[0]) return rows[0].id;
  }
  const { rows } = await c.query(
    `INSERT INTO contacts (workspace_id, name, phone, email, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL DO NOTHING
     RETURNING id`,
    [ws, name, phone, email, source, createdBy || null]
  );
  if (rows[0]) return rows[0].id;
  const again = await c.query('SELECT id FROM contacts WHERE workspace_id = $1 AND phone = $2 AND deleted_at IS NULL', [ws, phone]);
  return again.rows[0].id;
}

module.exports = router;
module.exports.normalizePhone = normalizePhone;
module.exports.findOrCreateContact = findOrCreateContact;
