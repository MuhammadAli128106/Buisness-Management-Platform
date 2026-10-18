'use strict';
/**
 * Lead engine (F3) — owner: Ali.  Spec: CLAUDE.md §9–§10.
 *
 * Invariants
 *  - A lead has ONE owner column (leads.owner_id) → two owners is impossible by construction (F3.8).
 *  - Deadlines live in the DB (leads.ack_deadline); the ticker does the work → restart-safe (Q5).
 *  - Every change is `UPDATE … WHERE id=$1 AND version=$2` → a lead is never escalated twice (F3.8).
 *  - Lock order is ALWAYS: assignment_rules row (FOR UPDATE) → lead rows. Nothing locks in the
 *    reverse order, so concurrent assign / escalate / absence never deadlock.
 *  - All time comparisons use Postgres now(), never the JS clock.
 *
 * Every exported function accepts an optional pg `client`; when given, all queries run on it
 * (the caller owns the transaction, e.g. Musa's Twilio webhook).
 */
const { pool, withTransaction } = require('../db/index');
const { audit } = require('../utils/audit');
const { logActivity } = require('../utils/activity');
const notify = require('./notify');

const SOURCE_LABEL = { web_form: 'Web form', whatsapp: 'WhatsApp', manual: 'Manual entry' };
const STATUSES = ['available', 'busy', 'on_leave', 'offline'];
const STATUS_LABEL = { available: 'Available', busy: 'Busy', on_leave: 'On leave', offline: 'Offline' };
const ACTION_KINDS = ['note', 'message', 'stage', 'appointment', 'call'];

// ───────────────────────── small helpers ─────────────────────────

function httpError(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  if (extra) Object.assign(err, extra);
  return err;
}

function inTx(client, fn) {
  return client ? fn(client) : withTransaction(fn);
}

async function one(c, sql, params) {
  const { rows } = await c.query(sql, params);
  return rows[0];
}

/** Audit needs a "req" to name the actor. Build a minimal one when we only have an actor id. */
async function actorReq(c, req, actorId) {
  if (req) return req;
  if (!actorId) return null; // null → "System"
  const u = await one(c, 'SELECT id, name, email, workspace_id AS ws FROM users WHERE id = $1', [actorId]);
  return u ? { user: u, ip: null, headers: {} } : null;
}

async function userName(c, userId) {
  if (!userId) return null;
  const u = await one(c, 'SELECT name FROM users WHERE id = $1', [userId]);
  return u ? u.name : null;
}

// Musa's helpers might still be stubs during the first hour — never let them break the engine flow
// except by a real DB error inside the transaction (which must roll back).
async function writeAudit(c, req, payload) {
  await audit(req, payload, c);
}
async function writeActivity(c, payload) {
  await logActivity(payload, c);
}

// ───────────────────────── rules & eligibility ─────────────────────────

function normalizeRules(r) {
  let esc = r.escalation;
  if (typeof esc === 'string') {
    try { esc = JSON.parse(esc); } catch (e) { esc = []; }
  }
  if (!Array.isArray(esc)) esc = [];
  return Object.assign({}, r, { escalation: esc });
}

/** Locks the workspace's rules row. Serialises every assignment decision in a workspace. */
async function lockRules(c, ws) {
  await c.query(
    'INSERT INTO assignment_rules (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING',
    [ws]
  );
  const r = await one(c, 'SELECT * FROM assignment_rules WHERE workspace_id = $1 FOR UPDATE', [ws]);
  return normalizeRules(r);
}

async function getRules(ws, client) {
  const c = client || pool;
  await c.query(
    'INSERT INTO assignment_rules (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING',
    [ws]
  );
  return normalizeRules(await one(c, 'SELECT * FROM assignment_rules WHERE workspace_id = $1', [ws]));
}

/** Glossary "Available employee": active, status available, open leads below the cap. */
async function eligibleUsers(c, ws, maxOpen, excludeIds) {
  const exclude = (excludeIds || []).filter(Boolean);
  const { rows } = await c.query(
    `SELECT u.id, u.name
       FROM users u
      WHERE u.workspace_id = $1
        AND u.is_active
        AND u.status = 'available'
        AND NOT (u.id = ANY($3::uuid[]))
        AND (SELECT count(*) FROM leads l
              WHERE l.workspace_id = $1 AND l.owner_id = u.id
                AND l.status IN ('assigned','acknowledged')) < $2
      ORDER BY u.id`,
    [ws, maxOpen, exclude]
  );
  return rows;
}

/** Round-robin: first eligible user whose id sorts after the cursor, wrapping around. */
function pickRoundRobin(users, cursor) {
  if (!users.length) return null;
  if (!cursor) return users[0];
  const next = users.find((u) => u.id > cursor);
  return next || users[0];
}

async function pickNext(c, ws, rules, excludeIds) {
  const users = await eligibleUsers(c, ws, rules.max_open_leads, excludeIds);
  const pick = pickRoundRobin(users, rules.rr_cursor);
  if (pick) {
    await c.query('UPDATE assignment_rules SET rr_cursor = $2 WHERE workspace_id = $1', [ws, pick.id]);
    rules.rr_cursor = pick.id;
  }
  return pick;
}

// ───────────────────────── core state transitions ─────────────────────────

const AUDIT_EVENT = {
  initial: 'lead.assigned',
  escalation: 'lead.escalated',
  absence: 'lead.reassigned_absence',
  manual: 'lead.reassigned_manual',
};

/**
 * Give `lead` to `toUser`. Returns the updated lead, or null if the lead's version moved
 * (someone else changed it first → caller treats it as "already handled").
 */
async function assignTo(c, opts) {
  const { ws, lead, toUser, reason, level, seconds, req, notifyReason } = opts;
  const updated = await one(
    c,
    `UPDATE leads
        SET owner_id = $2,
            first_owner_id = COALESCE(first_owner_id, $2),
            status = 'assigned',
            assigned_at = now(),
            first_assigned_at = COALESCE(first_assigned_at, now()),
            ack_deadline = now() + ($3::int * interval '1 second'),
            escalation_level = $4,
            escalation_count = escalation_count + $5,
            version = version + 1,
            updated_at = now()
      WHERE id = $1 AND version = $6
      RETURNING *`,
    [lead.id, toUser.id, Math.max(1, Math.round(seconds)), level, reason === 'escalation' ? 1 : 0, lead.version]
  );
  if (!updated) return null;

  const fromName = await userName(c, lead.owner_id);
  const actorId = req && req.user ? req.user.id : null;

  await c.query(
    `INSERT INTO lead_assignments (workspace_id, lead_id, from_user_id, to_user_id, reason, level, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ws, lead.id, lead.owner_id || null, toUser.id, reason, level, actorId]
  );

  await writeAudit(c, req || null, {
    ws,
    event_type: AUDIT_EVENT[reason],
    target_type: 'lead',
    target_id: lead.id,
    before: { owner_id: lead.owner_id || null, owner_name: fromName, status: lead.status, escalation_level: lead.escalation_level },
    after: { owner_id: toUser.id, owner_name: toUser.name, status: 'assigned', escalation_level: level, reason: notifyReason || null },
  });

  let summary;
  if (reason === 'initial') summary = `Lead assigned to ${toUser.name}`;
  else if (reason === 'escalation') summary = `Lead escalated from ${fromName || 'nobody'} to ${toUser.name} (level ${level})`;
  else if (reason === 'absence') summary = `Lead moved from ${fromName} to ${toUser.name} because ${fromName} is unavailable`;
  else summary = `Lead reassigned from ${fromName || 'nobody'} to ${toUser.name}`;

  await writeActivity(c, {
    ws,
    contact_id: lead.contact_id,
    opportunity_id: lead.opportunity_id,
    lead_id: lead.id,
    type: reason === 'escalation' ? 'escalation' : 'assignment',
    actor_id: actorId,
    summary,
    data: { from_user_id: lead.owner_id || null, to_user_id: toUser.id, reason, level },
  });

  // F3.9 / I4: alert the new owner outside the app. Queued in the same transaction,
  // sent by the ticker (with retries) right after commit.
  if (reason === 'escalation' || reason === 'absence' || reason === 'manual') {
    await notify.escalation({
      ws,
      userId: toUser.id,
      lead: updated,
      reason: notifyReason || summary,
      client: c,
    });
  }
  return updated;
}

/** Nobody can take it → owner NULL, shows in the recovery queue. */
async function unassign(c, { ws, lead, reasonText, countEscalation, req }) {
  const updated = await one(
    c,
    `UPDATE leads
        SET owner_id = NULL, status = 'unassigned', ack_deadline = NULL,
            escalation_count = escalation_count + $3,
            version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *`,
    [lead.id, lead.version, countEscalation ? 1 : 0]
  );
  if (!updated) return null;

  const fromName = await userName(c, lead.owner_id);
  await c.query(
    `INSERT INTO lead_assignments (workspace_id, lead_id, from_user_id, to_user_id, reason, level, actor_id)
     VALUES ($1, $2, $3, NULL, 'unassigned', $4, $5)`,
    [ws, lead.id, lead.owner_id || null, lead.escalation_level, req && req.user ? req.user.id : null]
  );
  await writeAudit(c, req || null, {
    ws,
    event_type: 'lead.unassigned',
    target_type: 'lead',
    target_id: lead.id,
    before: { owner_id: lead.owner_id || null, owner_name: fromName, status: lead.status },
    after: { owner_id: null, status: 'unassigned', reason: reasonText },
  });
  await writeActivity(c, {
    ws,
    contact_id: lead.contact_id,
    opportunity_id: lead.opportunity_id,
    lead_id: lead.id,
    type: 'assignment',
    actor_id: req && req.user ? req.user.id : null,
    summary: `Lead unassigned: ${reasonText}`,
    data: { from_user_id: lead.owner_id || null, reason: 'unassigned' },
  });
  return updated;
}

// ───────────────────────── public API (CLAUDE.md §9) ─────────────────────────

/**
 * createLead({ ws, contactId, source, sourceDetail, opportunityId = null, actorId = null, client })
 * → lead row. Assigns immediately, or status 'unassigned' if nobody is eligible.
 * If the contact already has an open lead, that lead is returned instead of creating a duplicate.
 */
async function createLead(opts) {
  const { ws, contactId, source } = opts;
  const sourceDetail = opts.sourceDetail || null;
  const opportunityId = opts.opportunityId || null;
  const actorId = opts.actorId || null;
  if (!SOURCE_LABEL[source]) throw httpError(400, `Unknown lead source "${source}"`);

  return inTx(opts.client, async (c) => {
    const contact = await one(
      c,
      'SELECT id, name FROM contacts WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL',
      [contactId, ws]
    );
    if (!contact) throw httpError(404, 'Not found');

    const existing = await one(
      c,
      `SELECT * FROM leads WHERE workspace_id = $1 AND contact_id = $2
          AND status IN ('assigned','acknowledged','unassigned')
        ORDER BY created_at DESC LIMIT 1`,
      [ws, contactId]
    );
    if (existing) {
      await c.query('UPDATE leads SET updated_at = now() WHERE id = $1', [existing.id]);
      await writeActivity(c, {
        ws,
        contact_id: contactId,
        opportunity_id: existing.opportunity_id,
        lead_id: existing.id,
        type: 'lead_created',
        actor_id: actorId,
        summary: `Contacted again via ${SOURCE_LABEL[source]} (existing open lead kept)`,
        data: { source, source_detail: sourceDetail, duplicate_of: existing.id },
      });
      return Object.assign({}, existing, { deduplicated: true });
    }

    const lead = await one(
      c,
      `INSERT INTO leads (workspace_id, contact_id, opportunity_id, source, source_detail, status)
       VALUES ($1, $2, $3, $4, $5, 'unassigned')
       RETURNING *`,
      [ws, contactId, opportunityId, source, sourceDetail]
    );

    const req = await actorReq(c, opts.req || null, actorId);
    await writeAudit(c, req, {
      ws,
      event_type: 'lead.created',
      target_type: 'lead',
      target_id: lead.id,
      before: null,
      after: { contact_id: contactId, contact_name: contact.name, source, source_detail: sourceDetail },
    });
    await writeActivity(c, {
      ws,
      contact_id: contactId,
      opportunity_id: opportunityId,
      lead_id: lead.id,
      type: 'lead_created',
      actor_id: actorId,
      summary: `New lead from ${SOURCE_LABEL[source]}`,
      data: { source, source_detail: sourceDetail },
    });

    const rules = await lockRules(c, ws);
    const pick = await pickNext(c, ws, rules, []);
    if (pick) {
      // Initial assignment is made by the system (round-robin), not by the person who entered it.
      return assignTo(c, {
        ws, lead, toUser: pick, reason: 'initial', level: 0, seconds: rules.ack_window_seconds, req: null,
      });
    }
    return unassign(c, { ws, lead, reasonText: 'No available employee under the open-lead limit', countEscalation: false, req: null });
  });
}

/**
 * recordAction({ ws, contactId, userId, kind, client })
 * Any recorded action (note, message, stage change, call, appointment) by the current owner
 * counts as acknowledgement (glossary). Always bumps last_action_at on the contact's open leads.
 */
async function recordAction(opts) {
  const { ws, contactId, userId } = opts;
  const kind = ACTION_KINDS.includes(opts.kind) ? opts.kind : 'note';
  if (!contactId) return { acknowledged: 0 };
  const c = opts.client || pool;

  await c.query(
    `UPDATE leads SET last_action_at = now(), updated_at = now()
      WHERE workspace_id = $1 AND contact_id = $2 AND status IN ('assigned','acknowledged')`,
    [ws, contactId]
  );
  if (!userId) return { acknowledged: 0 };

  const { rows } = await c.query(
    `UPDATE leads
        SET status = 'acknowledged', first_ack_at = COALESCE(first_ack_at, now()),
            ack_deadline = NULL, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND contact_id = $2 AND owner_id = $3 AND status = 'assigned'
      RETURNING *`,
    [ws, contactId, userId]
  );
  if (rows.length) {
    const req = await actorReq(c, opts.req || null, userId);
    for (const lead of rows) {
      await writeAudit(c, req, {
        ws, event_type: 'lead.acknowledged', target_type: 'lead', target_id: lead.id,
        before: { status: 'assigned' }, after: { status: 'acknowledged', by_action: kind },
      });
      await writeActivity(c, {
        ws, contact_id: lead.contact_id, opportunity_id: lead.opportunity_id, lead_id: lead.id,
        type: 'acknowledged', actor_id: userId,
        summary: `Lead acknowledged by action (${kind})`, data: { kind },
      });
    }
  }
  return { acknowledged: rows.length };
}

/** POST /leads/:id/ack — only the current owner. Idempotent if already acknowledged by them. */
async function acknowledge({ ws, leadId, userId, req, client }) {
  return inTx(client, async (c) => {
    const lead = await one(c, 'SELECT * FROM leads WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [leadId, ws]);
    if (!lead) throw httpError(404, 'Not found');
    if (lead.owner_id !== userId) throw httpError(403, 'Only the person this lead is assigned to can acknowledge it');
    if (lead.status === 'acknowledged') return lead;
    if (lead.status !== 'assigned') throw httpError(409, `This lead is ${lead.status} and cannot be acknowledged`);

    const updated = await one(
      c,
      `UPDATE leads
          SET status = 'acknowledged', first_ack_at = COALESCE(first_ack_at, now()),
              ack_deadline = NULL, last_action_at = now(), version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2
        RETURNING *`,
      [lead.id, lead.version]
    );
    await writeAudit(c, req || null, {
      ws, event_type: 'lead.acknowledged', target_type: 'lead', target_id: lead.id,
      before: { status: 'assigned' }, after: { status: 'acknowledged' },
    });
    await writeActivity(c, {
      ws, contact_id: lead.contact_id, opportunity_id: lead.opportunity_id, lead_id: lead.id,
      type: 'acknowledged', actor_id: userId, summary: 'Lead acknowledged', data: {},
    });
    return updated;
  });
}

/** POST /leads/:id/reassign — manual reassignment (counted separately from escalations). */
async function reassignManual({ ws, leadId, toUserId, version, req, client }) {
  return inTx(client, async (c) => {
    const rules = await lockRules(c, ws);
    const lead = await one(c, 'SELECT * FROM leads WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [leadId, ws]);
    if (!lead) throw httpError(404, 'Not found');
    if (lead.status === 'closed') throw httpError(409, 'This lead is closed');
    if (version !== undefined && version !== null && Number(version) !== lead.version) {
      throw httpError(409, 'Someone else changed this lead. Reload and try again.', { current: lead });
    }
    const target = await one(
      c,
      'SELECT id, name, status, is_active FROM users WHERE id = $1 AND workspace_id = $2',
      [toUserId, ws]
    );
    if (!target || !target.is_active) throw httpError(404, 'User not found');
    if (target.status === 'on_leave' || target.status === 'offline') {
      throw httpError(422, `${target.name} is ${STATUS_LABEL[target.status]} and can't receive leads`);
    }
    if (lead.owner_id === target.id && lead.status !== 'unassigned') {
      throw httpError(422, `This lead is already assigned to ${target.name}`);
    }
    const updated = await assignTo(c, {
      ws, lead, toUser: target, reason: 'manual', level: 0, seconds: rules.ack_window_seconds, req,
      notifyReason: `Reassigned to you by ${req && req.user ? req.user.name : 'a manager'}`,
    });
    if (!updated) throw httpError(409, 'Someone else changed this lead. Reload and try again.');
    return updated;
  });
}

/** POST /leads/:id/close */
async function closeLead({ ws, leadId, req, client }) {
  return inTx(client, async (c) => {
    const lead = await one(c, 'SELECT * FROM leads WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [leadId, ws]);
    if (!lead) throw httpError(404, 'Not found');
    if (lead.status === 'closed') return lead;
    const updated = await one(
      c,
      `UPDATE leads SET status = 'closed', ack_deadline = NULL, last_action_at = now(),
              version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [lead.id]
    );
    await writeAudit(c, req || null, {
      ws, event_type: 'lead.closed', target_type: 'lead', target_id: lead.id,
      before: { status: lead.status, owner_id: lead.owner_id }, after: { status: 'closed' },
    });
    await writeActivity(c, {
      ws, contact_id: lead.contact_id, opportunity_id: lead.opportunity_id, lead_id: lead.id,
      type: 'assignment', actor_id: req && req.user ? req.user.id : null, summary: 'Lead closed', data: {},
    });
    return updated;
  });
}

/** Used by Musa's contact delete. */
async function closeLeadsForContact({ ws, contactId, client }) {
  const c = client || pool;
  const { rows } = await c.query(
    `UPDATE leads SET status = 'closed', ack_deadline = NULL, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND contact_id = $2 AND status <> 'closed'
      RETURNING id`,
    [ws, contactId]
  );
  return rows.length;
}

/**
 * onStatusChange({ ws, userId, status, actorId }) — F3.2 / F3.6.
 * Sets users.status; going On leave / Offline immediately moves their unacknowledged leads
 * (and acknowledged ones too when the rule says 'reassign').
 */
async function onStatusChange(opts) {
  const { ws, userId, status } = opts;
  if (!STATUSES.includes(status)) throw httpError(400, `Status must be one of: ${STATUSES.join(', ')}`);

  return inTx(opts.client, async (c) => {
    const user = await one(c, 'SELECT id, name, status FROM users WHERE id = $1 AND workspace_id = $2', [userId, ws]);
    if (!user) throw httpError(404, 'Not found');

    await c.query('UPDATE users SET status = $3, updated_at = now() WHERE id = $1 AND workspace_id = $2', [userId, ws, status]);
    const req = await actorReq(c, opts.req || null, opts.actorId || null);
    if (user.status !== status) {
      await writeAudit(c, req, {
        ws, event_type: 'user.status_changed', target_type: 'user', target_id: userId,
        before: { status: user.status }, after: { status },
      });
    }

    const result = { status, reassigned: 0, unassigned: 0, kept: 0, policy: null };
    if (status !== 'on_leave' && status !== 'offline') return result;

    const rules = await lockRules(c, ws);
    result.policy = rules.on_absence_acknowledged;
    const moveStatuses = rules.on_absence_acknowledged === 'reassign' ? ['assigned', 'acknowledged'] : ['assigned'];

    const { rows: leads } = await c.query(
      `SELECT * FROM leads WHERE workspace_id = $1 AND owner_id = $2 AND status = ANY($3::text[])
        ORDER BY created_at FOR UPDATE`,
      [ws, userId, moveStatuses]
    );
    const why = `${user.name} is ${STATUS_LABEL[status]}`;
    for (const lead of leads) {
      const pick = await pickNext(c, ws, rules, [userId]);
      if (pick) {
        const ok = await assignTo(c, {
          ws, lead, toUser: pick, reason: 'absence', level: 0, seconds: rules.ack_window_seconds, req,
          notifyReason: `${why}, so the lead moved to you`,
        });
        if (ok) result.reassigned += 1;
      } else {
        const ok = await unassign(c, { ws, lead, reasonText: `${why} and nobody else is available`, countEscalation: false, req });
        if (ok) result.unassigned += 1;
      }
    }
    if (rules.on_absence_acknowledged === 'keep') {
      const k = await one(
        c,
        `SELECT count(*)::int AS n FROM leads WHERE workspace_id = $1 AND owner_id = $2 AND status = 'acknowledged'`,
        [ws, userId]
      );
      result.kept = k.n;
    }
    return result;
  });
}

// ───────────────────────── escalation (called by the ticker) ─────────────────────────

async function resolveTarget(c, ws, rules, lead, to) {
  const firstOwner = lead.first_owner_id || lead.owner_id;
  if (to === 'next') {
    return pickNext(c, ws, rules, [lead.owner_id]);
  }
  if (to === 'backup') {
    return one(
      c,
      `SELECT b.id, b.name FROM users f JOIN users b ON b.id = f.backup_user_id
        WHERE f.id = $1 AND b.workspace_id = $2 AND b.is_active
          AND b.status NOT IN ('on_leave','offline') AND b.id IS DISTINCT FROM $3`,
      [firstOwner, ws, lead.owner_id]
    );
  }
  if (to === 'manager') {
    // The manager is the last line: open-lead cap is ignored, only "offline" excludes them.
    return one(
      c,
      `SELECT m.id, m.name FROM users f JOIN users m ON m.id = f.manager_user_id
        WHERE f.id = $1 AND m.workspace_id = $2 AND m.is_active
          AND m.status <> 'offline' AND m.id IS DISTINCT FROM $3`,
      [firstOwner, ws, lead.owner_id]
    );
  }
  return null;
}

/** Escalate one lead if (still) overdue. Returns true if this call changed it. */
async function escalateOne(ws, leadId) {
  return withTransaction(async (c) => {
    const rules = await lockRules(c, ws);
    // Re-check under lock: another ticker / an ack may have handled it while we waited.
    const lead = await one(
      c,
      `SELECT * FROM leads
        WHERE id = $1 AND workspace_id = $2 AND status = 'assigned' AND ack_deadline < now()
        FOR UPDATE SKIP LOCKED`,
      [leadId, ws]
    );
    if (!lead) return false;

    const prevName = (await userName(c, lead.owner_id)) || 'the previous owner';
    const chain = rules.escalation;
    const reasonText = `Not acknowledged by ${prevName} in time`;

    for (let level = lead.escalation_level + 1; level <= chain.length; level += 1) {
      const step = chain[level - 1] || {};
      const target = await resolveTarget(c, ws, rules, lead, step.to);
      if (!target) continue; // missing / ineligible → skip to the following level
      const seconds = Number(step.seconds) > 0 ? Number(step.seconds) : rules.ack_window_seconds;
      const updated = await assignTo(c, {
        ws, lead, toUser: target, reason: 'escalation', level, seconds, req: null, notifyReason: reasonText,
      });
      return Boolean(updated);
    }
    const updated = await unassign(c, {
      ws, lead, reasonText: `${reasonText}; nobody left in the escalation chain`, countEscalation: true, req: null,
    });
    return Boolean(updated);
  });
}

/** One ticker pass. Errors on one lead never stop the others. */
async function escalateDue(limit) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id FROM leads
      WHERE status = 'assigned' AND ack_deadline < now()
      ORDER BY ack_deadline LIMIT $1`,
    [limit || 20]
  );
  let changed = 0;
  for (const row of rows) {
    try {
      if (await escalateOne(row.workspace_id, row.id)) changed += 1;
    } catch (err) {
      console.error(`[leadEngine] escalation failed for lead ${row.id}: ${err.message}`);
    }
  }
  return changed;
}

// ───────────────────────── recovery queue (F3.7, CLAUDE.md §10) ─────────────────────────

/**
 * SQL fragment for "is a recovery queue item". Needs `leads <l>` joined with
 * `assignment_rules <r>` ON r.workspace_id = l.workspace_id (use RECOVERY_JOIN).
 * Musa's metrics.js reuses this so the dashboard count == the Recovery page.
 */
const RECOVERY_JOIN = 'JOIN assignment_rules r ON r.workspace_id = l.workspace_id';

function recoveryConditions(l, r) {
  const a = l || 'l';
  const b = r || 'r';
  return {
    unassigned: `${a}.status = 'unassigned'`,
    overdue: `(${a}.status = 'assigned' AND ${a}.ack_deadline < now())`,
    escalated: `${a}.escalation_count >= 2`,
    idle: `(${a}.status IN ('assigned','acknowledged') AND COALESCE(${a}.last_action_at, ${a}.assigned_at) < now() - (${b}.idle_seconds * interval '1 second'))`,
  };
}

/** → { sql } — boolean expression over leads alias `l` and assignment_rules alias `r` (Musa's contract). */
function recoveryWhereSql(l, r) {
  const k = recoveryConditions(l, r);
  return { sql: `(${l || 'l'}.status <> 'closed' AND (${k.unassigned} OR ${k.overdue} OR ${k.escalated} OR ${k.idle}))` };
}

async function listRecovery({ ws, page, limit, client }) {
  const c = client || pool;
  await getRules(ws, c);
  const k = recoveryConditions('l', 'r');
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  const where = `l.workspace_id = $1 AND ${recoveryWhereSql('l', 'r').sql}`;
  const { rows } = await c.query(
    `SELECT l.*, ct.name AS contact_name, ct.phone AS contact_phone, u.name AS owner_name,
            EXTRACT(EPOCH FROM (l.ack_deadline - now()))::int AS seconds_left,
            ${k.unassigned} AS r_unassigned, ${k.overdue} AS r_overdue,
            ${k.escalated} AS r_escalated, ${k.idle} AS r_idle, r.idle_seconds
       FROM leads l ${RECOVERY_JOIN}
       JOIN contacts ct ON ct.id = l.contact_id
       LEFT JOIN users u ON u.id = l.owner_id
      WHERE ${where}
      ORDER BY l.created_at ASC
      LIMIT $2 OFFSET $3`,
    [ws, lim, off]
  );
  const total = await one(c, `SELECT count(*)::int AS n FROM leads l ${RECOVERY_JOIN} WHERE ${where}`, [ws]);
  const data = rows.map((row) => {
    const reasons = [];
    if (row.r_unassigned) reasons.push('No owner (nobody was available)');
    if (row.r_overdue) reasons.push('Unacknowledged past window');
    if (row.r_escalated) reasons.push(`Escalated ${row.escalation_count} times`);
    if (row.r_idle) reasons.push(`No action for ${Math.round(row.idle_seconds / 60) || 1} min`);
    const out = Object.assign({}, row, { reasons });
    delete out.r_unassigned; delete out.r_overdue; delete out.r_escalated; delete out.r_idle;
    return out;
  });
  return { data, total: total.n, page: Math.max(Number(page) || 1, 1), limit: lim };
}

module.exports = {
  // §9 contract
  createLead,
  recordAction,
  onStatusChange,
  closeLeadsForContact,
  // used by Ali's routes / ticker
  acknowledge,
  reassignManual,
  closeLead,
  escalateDue,
  escalateOne,
  listRecovery,
  getRules,
  // shared SQL for Musa's metrics.js
  recoveryWhereSql,
  RECOVERY_JOIN,
  // constants
  STATUSES,
  STATUS_LABEL,
  SOURCE_LABEL,
  httpError,
};
