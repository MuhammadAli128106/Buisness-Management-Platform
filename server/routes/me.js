// PUT /me/prefs — dashboard hide/show (F5.5). (Status & Telegram are Ali's: routes/availability.js, routes/telegram.js)
const express = require('express');
const { z } = require('zod');
const { queryOne } = require('../db/index');
const { validate } = require('../middleware/validate');

const router = express.Router();

router.put('/me/prefs', validate({
  body: z.object({ dashboard_hidden: z.array(z.string().max(60)).max(50).optional(), timezone: z.string().max(60).optional() }),
}), async (req, res, next) => {
  try {
    const prefs = { ...(req.user.prefs || {}) };
    if (req.body.dashboard_hidden) prefs.dashboard_hidden = req.body.dashboard_hidden;
    const row = await queryOne(
      `UPDATE users SET prefs = $3, timezone = COALESCE($4, timezone), updated_at = now()
        WHERE id = $1 AND workspace_id = $2 RETURNING prefs, timezone`,
      [req.user.id, req.user.ws, JSON.stringify(prefs), req.body.timezone ?? null],
    );
    res.json({ data: row });
  } catch (e) { next(e); }
});

module.exports = router;
