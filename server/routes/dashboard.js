// GET /dashboard (F5.1–F5.4) — owner: Musa. Figures defined in services/metrics.js.
const express = require('express');
const { dashboard } = require('../services/metrics');

const router = express.Router();
router.get('/', async (req, res, next) => {
  try { res.json({ data: await dashboard(req) }); } catch (e) { next(e); }
});
module.exports = router;
