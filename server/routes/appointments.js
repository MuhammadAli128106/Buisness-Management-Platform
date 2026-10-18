'use strict';
/**
 * Appointments (I3.3–I3.7) — owner: Ali. Mounted at /api/v1/appointments.
 * Booking writes to the employee's real Google Calendar first; the row is only saved if Google accepted it,
 * so the platform and the calendar never disagree. Times are stored as timestamptz (UTC) + IANA timezone.
 */
const express = require('express');
const { z } = require('zod');
const { pool, withTransaction } = require('../db/index');
const { requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { isUuid } = require('../utils/dbSecurity');
const { audit } = require('../utils/audit');
const { logActivity } = require('../utils/activity');
const leadEngine = require('../services/leadEngine');
const google = require('../services/google');

const router = express.Router();

const fail = (res, err, next) => {
  if (err && err.status && err.status < 600) {
    const body = { error: err.message };
    if (err.conflicts) body.conflicts = err.conflicts;
    if (err.current) body.current = err.current;
    return res.status(err.status >= 500 ? 502 : err.status).json(body);
  }
  return next(err);
};
const httpErr = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});

function validTimezone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}
function fmt(d, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(d)) + ` (${tz})`;
  } catch (e) { return new Date(d).toISOString(); }
}

const SELECT = `
  SELECT a.*, u.name AS user_name, c.name AS contact_name, o.title AS opportunity_title, cb.name AS created_by_name
    FROM appointments a
    JOIN users u ON u.id = a.user_id
    JOIN contacts c ON c.id = a.contact_id
    LEFT JOIN opportunities o ON o.id = a.opportunity_id
    LEFT JOIN users cb ON cb.id = a.created_by`;

router.get('/', requirePerm('crm.view'), async (req, res, next) => {
  try {
    const params = [req.user.ws];
    const where = ['a.workspace_id = $1'];
    if (isUuid(req.query.contact_id)) { params.push(req.query.contact_id); where.push(`a.contact_id = $${params.length}`); }
    if (isUuid(req.query.opportunity_id)) { params.push(req.query.opportunity_id); where.push(`a.opportunity_id = $${params.length}`); }
    if (isUuid(req.query.user_id)) { params.push(req.query.user_id); where.push(`a.user_id = $${params.length}`); }
    if (req.query.upcoming === '1') where.push(`a.status = 'scheduled' AND a.ends_at > now()`);
    const { rows } = await pool.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.starts_at DESC LIMIT 100`, params);
    res.json({ data: rows });
  } catch (e) { next(e); }
});

/** Busy intervals that overlap [start,end), ignoring the appointment's own current slot when rescheduling. */
async function conflictsFor({ ws, userId, start, end, ignore }) {
  const busy = await google.getBusy({ ws, userId, from: start, to: end });
  if (busy.status !== 'ok') throw httpErr(409, busy.message || 'This person’s Google Calendar isn’t connected, so they can’t be booked.');
  return busy.busy.filter((b) => {
    const s = new Date(b.start).getTime(); const e = new Date(b.end).getTime();
    if (ignore && s === new Date(ignore.starts_at).getTime() && e === new Date(ignore.ends_at).getTime()) return false;
    return s < end.getTime() && e > start.getTime();
  });
}

const createBody = z.object({
  contact_id: z.string().uuid(),
  opportunity_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid(),
  title: z.string().trim().min(1, 'Give the appointment a title').max(200),
  starts_at: z.string().min(10),
  ends_at: z.string().min(10),
  timezone: z.string().min(1).max(64),
  notes: z.string().max(2000).optional(),
  force: z.boolean().optional(),
});

router.post('/', requirePerm('crm.edit'), validate({ body: createBody }), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    const b = req.body;
    const start = new Date(b.starts_at); const end = new Date(b.ends_at);
    const details = {};
    if (Number.isNaN(start.getTime())) details.starts_at = 'Pick a valid start time';
    if (Number.isNaN(end.getTime())) details.ends_at = 'Pick a valid end time';
    if (!details.starts_at && !details.ends_at && end <= start) details.ends_at = 'The end must be after the start';
    if (!validTimezone(b.timezone)) details.timezone = 'Unknown timezone';
    if (Object.keys(details).length) return res.status(400).json({ error: 'Invalid input', details });

    const { rows: [contact] } = await pool.query('SELECT id, name FROM contacts WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL', [b.contact_id, ws]);
    if (!contact) return res.status(404).json({ error: 'Not found' });
    if (b.opportunity_id) {
      const { rows: [opp] } = await pool.query('SELECT id FROM opportunities WHERE id = $1 AND workspace_id = $2 AND contact_id = $3 AND deleted_at IS NULL', [b.opportunity_id, ws, b.contact_id]);
      if (!opp) return res.status(404).json({ error: 'Not found' });
    }
    const { rows: [emp] } = await pool.query('SELECT id, name FROM users WHERE id = $1 AND workspace_id = $2 AND is_active', [b.user_id, ws]);
    if (!emp) return res.status(404).json({ error: 'Not found' });

    if (!b.force) {
      const conflicts = await conflictsFor({ ws, userId: emp.id, start, end });
      if (conflicts.length) throw httpErr(409, `${emp.name} is busy at that time`, { conflicts });
    }

    const eventId = await google.createEvent({
      ws, userId: emp.id, title: b.title, startsAt: start, endsAt: end, timezone: b.timezone,
      description: `Customer: ${contact.name}${b.notes ? `\n\n${b.notes}` : ''}\n\nBooked by ${req.user.name} in LeadGuard.`,
    });

    const appt = await withTransaction(async (c) => {
      const { rows: [row] } = await c.query(
        `INSERT INTO appointments (workspace_id, contact_id, opportunity_id, user_id, title, starts_at, ends_at, timezone, google_event_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [ws, contact.id, b.opportunity_id || null, emp.id, b.title, start, end, b.timezone, eventId, req.user.id]
      );
      await logActivity({
        ws, contact_id: contact.id, opportunity_id: b.opportunity_id || null, type: 'appointment', actor_id: req.user.id,
        summary: `Appointment booked with ${emp.name}: ${b.title}, ${fmt(start, b.timezone)}${b.force ? ' (booked over a busy slot)' : ''}`,
        data: { appointment_id: row.id, user_id: emp.id, starts_at: start, ends_at: end, timezone: b.timezone },
      }, c);
      await audit(req, { ws, event_type: 'appointment.created', target_type: 'appointment', target_id: row.id,
        after: { user: emp.name, contact: contact.name, title: b.title, starts_at: start, ends_at: end, timezone: b.timezone, forced: Boolean(b.force) } }, c);
      await leadEngine.recordAction({ ws, contactId: contact.id, userId: req.user.id, kind: 'appointment', client: c });
      return row;
    });
    const { rows: [full] } = await pool.query(`${SELECT} WHERE a.id = $1`, [appt.id]);
    res.status(201).json({ data: full });
  } catch (err) { fail(res, err, next); }
});

const patchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  starts_at: z.string().min(10).optional(),
  ends_at: z.string().min(10).optional(),
  timezone: z.string().min(1).max(64).optional(),
  version: z.number().int(),
  force: z.boolean().optional(),
});

router.patch('/:id', requirePerm('crm.edit'), validate({ body: patchBody }), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { rows: [before] } = await pool.query(`${SELECT} WHERE a.id = $1 AND a.workspace_id = $2`, [req.params.id, ws]);
    if (!before) return res.status(404).json({ error: 'Not found' });
    if (before.status === 'cancelled') return res.status(409).json({ error: 'This appointment was cancelled' });
    if (before.version !== req.body.version) return res.status(409).json({ error: 'Someone else changed this appointment. Reload and try again.', current: before });

    const title = req.body.title || before.title;
    const tz = req.body.timezone || before.timezone;
    const start = new Date(req.body.starts_at || before.starts_at);
    const end = new Date(req.body.ends_at || before.ends_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ error: 'Invalid input', details: { ends_at: 'The end must be after the start' } });
    }
    if (!validTimezone(tz)) return res.status(400).json({ error: 'Invalid input', details: { timezone: 'Unknown timezone' } });

    const moved = start.getTime() !== new Date(before.starts_at).getTime() || end.getTime() !== new Date(before.ends_at).getTime();
    if (moved && !req.body.force) {
      const conflicts = await conflictsFor({ ws, userId: before.user_id, start, end, ignore: before });
      if (conflicts.length) throw httpErr(409, `${before.user_name} is busy at that time`, { conflicts });
    }
    if (before.google_event_id) {
      await google.updateEvent({ ws, userId: before.user_id, eventId: before.google_event_id, title, startsAt: start, endsAt: end, timezone: tz,
        description: `Customer: ${before.contact_name}\n\nUpdated by ${req.user.name} in LeadGuard.` });
    }
    await withTransaction(async (c) => {
      const { rowCount } = await c.query(
        `UPDATE appointments SET title = $3, starts_at = $4, ends_at = $5, timezone = $6, version = version + 1, updated_at = now()
          WHERE id = $1 AND workspace_id = $2 AND version = $7`,
        [before.id, ws, title, start, end, tz, before.version]
      );
      if (!rowCount) throw httpErr(409, 'Someone else changed this appointment. Reload and try again.');
      await logActivity({
        ws, contact_id: before.contact_id, opportunity_id: before.opportunity_id, type: 'appointment', actor_id: req.user.id,
        summary: moved ? `Appointment rescheduled: ${fmt(before.starts_at, before.timezone)} → ${fmt(start, tz)}` : `Appointment renamed to “${title}”`,
        data: { appointment_id: before.id },
      }, c);
      await audit(req, { ws, event_type: 'appointment.updated', target_type: 'appointment', target_id: before.id,
        before: { title: before.title, starts_at: before.starts_at, ends_at: before.ends_at, timezone: before.timezone },
        after: { title, starts_at: start, ends_at: end, timezone: tz } }, c);
    });
    const { rows: [full] } = await pool.query(`${SELECT} WHERE a.id = $1`, [before.id]);
    res.json({ data: full });
  } catch (err) { fail(res, err, next); }
});

router.delete('/:id', requirePerm('crm.edit'), async (req, res, next) => {
  try {
    const ws = req.user.ws;
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { rows: [before] } = await pool.query(`${SELECT} WHERE a.id = $1 AND a.workspace_id = $2`, [req.params.id, ws]);
    if (!before) return res.status(404).json({ error: 'Not found' });
    if (before.status === 'cancelled') return res.json({ data: before });
    if (before.google_event_id) await google.deleteEvent({ ws, userId: before.user_id, eventId: before.google_event_id });
    await withTransaction(async (c) => {
      await c.query(`UPDATE appointments SET status = 'cancelled', version = version + 1, updated_at = now() WHERE id = $1`, [before.id]);
      await logActivity({ ws, contact_id: before.contact_id, opportunity_id: before.opportunity_id, type: 'appointment', actor_id: req.user.id,
        summary: `Appointment cancelled: ${before.title}, ${fmt(before.starts_at, before.timezone)}`, data: { appointment_id: before.id } }, c);
      await audit(req, { ws, event_type: 'appointment.cancelled', target_type: 'appointment', target_id: before.id,
        before: { title: before.title, starts_at: before.starts_at, user: before.user_name }, after: { status: 'cancelled' } }, c);
    });
    res.json({ data: { ...before, status: 'cancelled' } });
  } catch (err) { fail(res, err, next); }
});

module.exports = router;
