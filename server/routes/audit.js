// Audit history (F4.2, F4.3) — owner: Musa. Read-only: there is deliberately NO write/update/delete route here,
// and the audit_log table rejects UPDATE/DELETE at the database level.
const express = require('express');
const { q } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { isUuid } = require('../utils/dbSecurity');

const router = express.Router();

router.get('/', requirePerm('audit.view'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const where = ['a.workspace_id = $1']; const params = [ws];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.event_type) {
      if (String(req.query.event_type).endsWith('.*')) add('a.event_type LIKE ?', `${String(req.query.event_type).slice(0, -1)}%`);
      else add('a.event_type = ?', req.query.event_type);
    }
    if (req.query.user_id === 'system') where.push('a.actor_id IS NULL');
    else if (isUuid(req.query.user_id)) add('a.actor_id = ?', req.query.user_id);
    if (req.query.target_type) add('a.target_type = ?', req.query.target_type);
    if (req.query.target_id) add('a.target_id = ?', String(req.query.target_id));
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) add('a.created_at >= ?::date', req.query.from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) add(`a.created_at < (?::date + interval '1 day')`, req.query.to);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const w = where.join(' AND ');
    const [rows, total, types] = await Promise.all([
      q().query(`SELECT a.* FROM audit_log a WHERE ${w} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params),
      q().query(`SELECT count(*)::int AS n FROM audit_log a WHERE ${w}`, params),
      q().query('SELECT DISTINCT event_type FROM audit_log WHERE workspace_id = $1 ORDER BY 1', [ws]),
    ]);
    res.json({ data: rows.rows, total: total.rows[0].n, page, limit, event_types: types.rows.map((t) => t.event_type) });
  } catch (e) { next(e); }
});

module.exports = router;
