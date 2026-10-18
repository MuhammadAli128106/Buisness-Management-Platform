// Field-level protection for opportunity value (F1.4). Use on EVERY opportunity payload: lists, detail, export, dashboard.
const { hasPerm } = require('../middleware/auth');

function maskOpp(row, req) {
  if (!row) return row;
  if (hasPerm(req, 'opp.value.view')) return { ...row, value_masked: false };
  return { ...row, value_cents: null, value_masked: true };
}
const maskOpps = (rows, req) => (rows || []).map((r) => maskOpp(r, req));
module.exports = { maskOpp, maskOpps };
