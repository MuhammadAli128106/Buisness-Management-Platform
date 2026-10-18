// STUB — owner: Ali. Implement per CLAUDE.md §9–§10. Keep these exact export names & signatures:
// other modules (Twilio webhook, notes, contact delete, user deactivation) already call them.

/** → lead row. Assigns immediately (or status 'unassigned' if nobody eligible). Use `client` for every query when given. */
// eslint-disable-next-line no-unused-vars
async function createLead({ ws, contactId, source, sourceDetail, opportunityId = null, actorId = null, client }) {
  console.warn('[leadEngine STUB] createLead called — not implemented yet');
  return null;
}

/** Bumps last_action_at on the contact's open leads; owner + 'assigned' → acknowledged. kind: note|message|stage|appointment|call */
// eslint-disable-next-line no-unused-vars
async function recordAction({ ws, contactId, userId, kind, client }) {}

/** F3.6 — on_leave/offline → reassign unacknowledged leads immediately. */
// eslint-disable-next-line no-unused-vars
async function onStatusChange({ ws, userId, status, actorId }) {}

/** Contact deleted → its open leads become 'closed'. */
// eslint-disable-next-line no-unused-vars
async function closeLeadsForContact({ ws, contactId, client }) {}

/** Optional: SQL fragment for the recovery queue so Musa's dashboard count matches /leads/recovery exactly.
 *  Return { sql: '<boolean expression over alias l and rules alias r>' }. */
function recoveryWhereSql() {
  return {
    sql: `(l.status = 'unassigned'
       OR (l.status = 'assigned' AND l.ack_deadline < now())
       OR l.escalation_count >= 2
       OR (l.status IN ('assigned','acknowledged') AND COALESCE(l.last_action_at, l.assigned_at) < now() - make_interval(secs => r.idle_seconds)))`,
  };
}

module.exports = { createLead, recordAction, onStatusChange, closeLeadsForContact, recoveryWhereSql };
