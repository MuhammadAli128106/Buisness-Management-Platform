// Notes (F2.7) — owner: Musa. A note counts as acting on the lead (glossary "Acknowledged").
const express = require('express');
const { z } = require('zod');
const { withTransaction } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { httpError } = require('../middleware/errorHandler');
const { findScoped } = require('../utils/dbSecurity');
const { logActivity } = require('../utils/activity');
const leadEngine = require('../services/leadEngine');

const router = express.Router();

router.post('/', requirePerm('crm.edit'), validate({
  body: z.object({
    contact_id: z.string().uuid().optional(),
    opportunity_id: z.string().uuid().optional(),
    body: z.string().trim().min(1, 'Write something first').max(5000),
  }).refine((b) => b.contact_id || b.opportunity_id, { message: 'A note needs a contact or opportunity', path: ['contact_id'] }),
}), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    let contactId = req.body.contact_id || null;
    if (req.body.opportunity_id) {
      const o = await findScoped('opportunities', req.body.opportunity_id, ws).catch(() => { throw httpError(400, 'Invalid opportunity'); });
      if (contactId && contactId !== o.contact_id) throw httpError(400, 'That opportunity belongs to a different contact');
      contactId = o.contact_id;
    } else {
      await findScoped('contacts', contactId, ws).catch(() => { throw httpError(400, 'Invalid contact'); });
    }
    const act = await withTransaction(async (c) => {
      const a = await logActivity({ ws, contact_id: contactId, opportunity_id: req.body.opportunity_id || null, type: 'note', actor_id: req.user.id, summary: req.body.body }, c);
      await leadEngine.recordAction({ ws, contactId, userId: req.user.id, kind: 'note', client: c });
      return a;
    });
    res.status(201).json({ data: { ...act, actor_name: req.user.name } });
  } catch (e) { next(e); }
});

module.exports = router;
