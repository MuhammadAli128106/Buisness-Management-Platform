'use strict';
/**
 * /api/v1/public/forms — owner: Ali (F3.1 web-form intake). PUBLIC: mounted by Musa before
 * requireAuth, CSRF and express.json, so this router parses its own (small) JSON body.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool, withTransaction } = require('../db/index');
const { logActivity } = require('../utils/activity');
const leadEngine = require('../services/leadEngine');
const { normalizePhone, findOrCreateContact } = require('./leads');

const router = express.Router();
router.use(express.json({ limit: '10kb' }));

const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many submissions from this network. Please try again in a few minutes.' },
});

const slugSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);

async function workspaceBySlug(slug) {
  if (!slugSchema.safeParse(slug).success) return null;
  const { rows } = await pool.query('SELECT id, name, slug FROM workspaces WHERE slug = $1', [slug]);
  return rows[0] || null;
}

// GET /public/forms/:slug → { data: { workspace_name } }
router.get('/:slug', async (req, res, next) => {
  try {
    const ws = await workspaceBySlug(req.params.slug);
    if (!ws) return res.status(404).json({ error: 'This form does not exist' });
    res.json({ data: { workspace_name: ws.name } });
  } catch (err) { next(err); }
});

const leadSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  email: z.string().trim().max(200).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  message: z.string().trim().max(2000).optional().default(''),
  website: z.string().optional().default(''), // honeypot: humans never see/fill it
});

// POST /public/forms/:slug/lead
router.post('/:slug/lead', submitLimiter, async (req, res, next) => {
  try {
    const ws = await workspaceBySlug(req.params.slug);
    if (!ws) return res.status(404).json({ error: 'This form does not exist' });

    const parsed = leadSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const details = {};
      for (const issue of parsed.error.issues) details[issue.path.join('.') || 'form'] = issue.message;
      return res.status(400).json({ error: 'Invalid input', details });
    }
    const body = parsed.data;
    if (body.website) return res.json({ data: { ok: true } }); // bot: pretend success, store nothing

    const phone = body.phone ? normalizePhone(body.phone) : null;
    const emailCheck = body.email ? z.string().email().safeParse(body.email) : { success: true };
    const details = {};
    if (body.phone && !phone) details.phone = 'Enter a valid phone number, e.g. +923001234567';
    if (!emailCheck.success) details.email = 'Enter a valid email address';
    if (!phone && !body.email && !details.phone) details.phone = 'Enter a phone number or an email so we can reach you';
    if (Object.keys(details).length) return res.status(400).json({ error: 'Invalid input', details });

    await withTransaction(async (c) => {
      const contactId = await findOrCreateContact(c, {
        ws: ws.id, name: body.name, phone, email: body.email ? body.email.toLowerCase() : null, source: 'web_form', createdBy: null,
      });
      if (body.message) {
        await logActivity({
          ws: ws.id, contact_id: contactId, opportunity_id: null, lead_id: null, type: 'note',
          actor_id: null, summary: `Web form message: ${body.message}`, data: { via: 'web_form' },
        }, c);
      }
      await leadEngine.createLead({
        ws: ws.id, contactId, source: 'web_form', sourceDetail: `Public form /f/${ws.slug}`, client: c,
      });
    });
    res.status(201).json({ data: { ok: true } });
  } catch (err) { next(err); }
});

module.exports = router;
