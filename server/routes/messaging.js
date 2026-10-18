// Conversations & messages over Telegram (I1.3, I1.6, I1.7, I1.9) — owner: Musa. Mounted at /api/v1.
const express = require('express');
const { z } = require('zod');
const { q } = require('../db/index');
const { requirePerm, hasPerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { isUuid } = require('../utils/dbSecurity');
const { sendToContact, retryMessage } = require('../services/messenger');

const router = express.Router();
const bodySchema = z.object({ body: z.string().trim().min(1, 'Type a message').max(1600) });

/** I1.6: everyone with leads.view_all sees all; others only conversations assigned to them or contacts they own. */
function visibility(req, params) {
  if (hasPerm(req, 'leads.view_all')) return '';
  params.push(req.user.id);
  return `AND (cv.assigned_user_id = $${params.length} OR ct.owner_id = $${params.length})`;
}

async function loadConversation(req, id) {
  if (!isUuid(id)) throw httpError(404, 'Not found');
  const params = [id, req.user.ws];
  const vis = visibility(req, params);
  const conv = (await q().query(
    `SELECT cv.*, ct.name AS contact_name, ct.phone AS contact_phone, ct.opted_out, ct.opted_out_reason, ct.owner_id AS contact_owner_id,
            u.name AS assigned_user_name
       FROM conversations cv JOIN contacts ct ON ct.id = cv.contact_id LEFT JOIN users u ON u.id = cv.assigned_user_id
      WHERE cv.id = $1 AND cv.workspace_id = $2 AND ct.deleted_at IS NULL ${vis}`, params,
  )).rows[0];
  if (!conv) throw httpError(404, 'Not found');
  return conv;
}

router.get('/conversations', requirePerm('crm.view'), async (req, res, next) => {
  try {
    const params = [req.user.ws];
    let vis = visibility(req, params);
    if (req.query.mine === '1') { params.push(req.user.id); vis += ` AND cv.assigned_user_id = $${params.length}`; }
    if (req.query.contact_id && isUuid(req.query.contact_id)) { params.push(req.query.contact_id); vis += ` AND cv.contact_id = $${params.length}`; }
    const rows = (await q().query(
      `SELECT cv.*, ct.name AS contact_name, ct.phone AS contact_phone, ct.opted_out, u.name AS assigned_user_name,
              lm.body AS last_message, lm.direction AS last_direction, lm.status AS last_status,
              (SELECT count(*) FROM messages m WHERE m.conversation_id = cv.id AND m.status IN ('failed','undelivered'))::int AS failed_count
         FROM conversations cv JOIN contacts ct ON ct.id = cv.contact_id AND ct.deleted_at IS NULL
         LEFT JOIN users u ON u.id = cv.assigned_user_id
         LEFT JOIN LATERAL (SELECT body, direction, status FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) lm ON true
        WHERE cv.workspace_id = $1 ${vis}
        ORDER BY cv.last_message_at DESC NULLS LAST LIMIT 200`, params,
    )).rows;
    res.json({ data: rows });
  } catch (e) { next(e); }
});

router.get('/conversations/:id/messages', requirePerm('crm.view'), async (req, res, next) => {
  try {
    const conv = await loadConversation(req, req.params.id);
    const messages = (await q().query(
      `SELECT m.*, u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.created_by
        WHERE m.conversation_id = $1 AND m.workspace_id = $2 ORDER BY m.created_at ASC LIMIT 500`, [conv.id, req.user.ws],
    )).rows;
    res.json({ data: { conversation: conv, messages } });
  } catch (e) { next(e); }
});

router.post('/conversations/:id/messages', requirePerm('crm.edit'), validate({ body: bodySchema }), async (req, res, next) => {
  try {
    const conv = await loadConversation(req, req.params.id);
    const m = await sendToContact({ ws: req.user.ws, contactId: conv.contact_id, body: req.body.body, userId: req.user.id });
    res.status(m.status === 'failed' ? 202 : 201).json({ data: m });
  } catch (e) { next(e); }
});

router.post('/contacts/:id/messages', requirePerm('crm.edit'), validate({ body: bodySchema }), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) throw httpError(404, 'Not found');
    const ct = (await q().query('SELECT id, owner_id FROM contacts WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL', [req.params.id, req.user.ws])).rows[0];
    if (!ct) throw httpError(404, 'Not found');
    const m = await sendToContact({ ws: req.user.ws, contactId: ct.id, body: req.body.body, userId: req.user.id });
    res.status(m.status === 'failed' ? 202 : 201).json({ data: m });
  } catch (e) { next(e); }
});

router.post('/messages/:id/retry', requirePerm('crm.edit'), async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) throw httpError(404, 'Not found');
    const owned = (await q().query(
      'SELECT cv.id FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE m.id = $1 AND m.workspace_id = $2', [req.params.id, req.user.ws],
    )).rows[0];
    if (!owned) throw httpError(404, 'Not found');
    await loadConversation(req, owned.id); // visibility check
    res.json({ data: await retryMessage({ ws: req.user.ws, messageId: req.params.id }) });
  } catch (e) { next(e); }
});

module.exports = router;
