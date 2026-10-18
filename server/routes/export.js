// CSV export (F1.3 export permission, F1.4 masking) — owner: Musa. GET /export/contacts.csv?<same filters as list>
const express = require('express');
const { requirePerm } = require('../middleware/auth');
const { httpError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');
const { maskOpps } = require('../utils/mask');
const crm = require('../services/crm');

const router = express.Router();
const MAP = { contacts: 'contact', companies: 'company', opportunities: 'opportunity' };
const COLUMNS = {
  contact: ['name', 'email', 'phone', 'company_name', 'owner_name', 'tags', 'source', 'opted_out', 'created_at'],
  company: ['name', 'domain', 'phone', 'owner_name', 'contact_count', 'created_at'],
  opportunity: ['title', 'contact_name', 'pipeline_name', 'stage_name', 'value', 'currency', 'owner_name', 'created_at'],
};

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV/formula injection guard (Q3)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/:file', requirePerm('crm.export'), async (req, res, next) => {
  try {
    const m = /^(contacts|companies|opportunities)\.csv$/.exec(req.params.file);
    if (!m) throw httpError(404, 'Not found');
    const entity = MAP[m[1]];
    const { rows, total } = await crm.list(entity, req.query, req.user.ws, { paginate: false });
    const defs = await crm.customDefs(req.user.ws, entity, null);
    let data = rows;
    if (entity === 'opportunity') {
      data = maskOpps(rows, req).map((r) => ({ ...r, value: r.value_masked ? 'Hidden' : (Number(r.value_cents) / 100).toFixed(2) }));
    }
    const header = [...COLUMNS[entity], ...defs.map((d) => d.label)];
    const lines = [header.map(csvCell).join(',')];
    for (const r of data) lines.push([...COLUMNS[entity].map((c) => csvCell(r[c])), ...defs.map((d) => csvCell(r.custom?.[d.key]))].join(','));
    await audit(req, { event_type: 'export.performed', target_type: entity, after: { rows: total, filters: req.query } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${m[1]}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${lines.join('\r\n')}`);
  } catch (e) { next(e); }
});

module.exports = router;
