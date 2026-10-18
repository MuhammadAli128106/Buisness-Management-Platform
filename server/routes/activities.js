// Activity timeline (F2.7) — owner: Musa. GET /activities?contact_id= | ?opportunity_id=
const express = require('express');
const { q } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { httpError } = require('../middleware/errorHandler');
const { findScoped } = require('../utils/dbSecurity');

const router = express.Router();

router.get('/', requirePerm('crm.view'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const { contact_id: cid, opportunity_id: oid } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    let rows;
    if (oid) {
      await findScoped('opportunities', oid, ws, { softDelete: false });
      rows = (await q().query(
        `SELECT a.*, u.name AS actor_name FROM activities a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.workspace_id = $1 AND a.opportunity_id = $2 ORDER BY a.created_at DESC LIMIT ${limit}`, [ws, oid])).rows;
    } else if (cid) {
      await findScoped('contacts', cid, ws, { softDelete: false });
      rows = (await q().query(
        `SELECT a.*, u.name AS actor_name FROM activities a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.workspace_id = $1 AND (a.contact_id = $2 OR a.opportunity_id IN (SELECT id FROM opportunities WHERE contact_id = $2))
          ORDER BY a.created_at DESC LIMIT ${limit}`, [ws, cid])).rows;
    } else {
      throw httpError(400, 'Pass contact_id or opportunity_id');
    }
    res.json({ data: rows.map((r) => ({ ...r, actor_name: r.actor_name || 'System' })) });
  } catch (e) { next(e); }
});

module.exports = router;
