// Dashboard figures (F5, CLAUDE.md §11) — owner: Musa. One definition per figure; drill-down lists use the same filters (Q12).
const { q } = require('../db/index');
const { hasPerm } = require('../middleware/auth');
const leadEngine = require('./leadEngine');
const { expireStale } = require('./googlePay');

/** Company-wide for Owner/Admin level, personal (own leads/opps/appointments) for User level (F5.4). */
async function dashboard(req) {
  const ws = req.user.ws;
  const personal = req.user.level === 'user';
  const me = req.user.id;
  const tz = req.user.timezone || 'Asia/Karachi';
  await expireStale(ws).catch(() => {});
  const own = (col) => (personal ? `AND ${col} = $2` : '');
  const P = personal ? [ws, me] : [ws];
  const recovery = leadEngine.recoveryWhereSql ? leadEngine.recoveryWhereSql().sql : null;
  const canValues = hasPerm(req, 'opp.value.view');

  const [newLeads, pipeline, firstResp, recov, esc, manual, avail, appts, collected, pendingPay, openLeads] = await Promise.all([
    q().query(`SELECT count(*)::int AS n FROM leads l WHERE l.workspace_id = $1 ${own('l.owner_id')}
               AND (l.created_at AT TIME ZONE '${tz.replace(/'/g, '')}')::date = (now() AT TIME ZONE '${tz.replace(/'/g, '')}')::date`, P),
    q().query(`SELECT s.id AS stage_id, s.name AS stage, p.name AS pipeline, s.position, count(o.id)::int AS count, COALESCE(sum(o.value_cents),0)::bigint AS value_cents
                 FROM stages s JOIN pipelines p ON p.id = s.pipeline_id
                 LEFT JOIN opportunities o ON o.stage_id = s.id AND o.deleted_at IS NULL ${personal ? 'AND o.owner_id = $2' : ''}
                WHERE s.workspace_id = $1 AND s.kind = 'open' GROUP BY s.id, s.name, p.name, s.position, p.position ORDER BY p.position, s.position`, P),
    q().query(`SELECT avg(EXTRACT(EPOCH FROM (l.first_ack_at - l.first_assigned_at)))::float AS secs, count(*)::int AS n
                 FROM leads l WHERE l.workspace_id = $1 ${own('l.first_owner_id')} AND l.first_ack_at IS NOT NULL
                  AND l.first_ack_at > now() - interval '30 days'`, P),
    recovery ? q().query(`SELECT count(*)::int AS n FROM leads l JOIN assignment_rules r ON r.workspace_id = l.workspace_id
                 WHERE l.workspace_id = $1 ${own('l.owner_id')} AND ${recovery}`, P) : { rows: [{ n: 0 }] },
    q().query(`SELECT count(*)::int AS n FROM lead_assignments a WHERE a.workspace_id = $1 ${own('a.to_user_id')} AND a.reason = 'escalation' AND a.created_at > now() - interval '24 hours'`, P),
    q().query(`SELECT count(*)::int AS n FROM lead_assignments a WHERE a.workspace_id = $1 ${own('a.to_user_id')} AND a.reason = 'manual' AND a.created_at > now() - interval '24 hours'`, P),
    q().query(`SELECT u.id, u.name, u.status,
                 (SELECT count(*) FROM leads l WHERE l.owner_id = u.id AND l.status IN ('assigned','acknowledged'))::int AS open_leads
                 FROM users u WHERE u.workspace_id = $1 AND u.is_active ORDER BY u.name`, [ws]),
    q().query(`SELECT a.id, a.title, a.starts_at, a.ends_at, a.timezone, a.contact_id, c.name AS contact_name, u.name AS user_name
                 FROM appointments a JOIN contacts c ON c.id = a.contact_id LEFT JOIN users u ON u.id = a.user_id
                WHERE a.workspace_id = $1 ${own('a.user_id')} AND a.status = 'scheduled' AND a.starts_at > now() ORDER BY a.starts_at LIMIT 5`, P),
    q().query(`SELECT COALESCE(sum(pm.amount_cents - pm.refunded_cents),0)::bigint AS cents, count(*)::int AS n, max(pm.currency) AS currency
                 FROM payments pm WHERE pm.workspace_id = $1 ${own('pm.requested_by')}
                  AND pm.status IN ('paid','partially_refunded','refunded') AND pm.paid_at >= date_trunc('month', now())`, P),
    q().query(`SELECT COALESCE(sum(pm.amount_cents),0)::bigint AS cents FROM payments pm WHERE pm.workspace_id = $1 ${own('pm.requested_by')} AND pm.status = 'pending'`, P),
    q().query(`SELECT count(*)::int AS n FROM leads l WHERE l.workspace_id = $1 ${own('l.owner_id')} AND l.status IN ('assigned','acknowledged')`, P),
  ]);

  const byStatus = { available: 0, busy: 0, on_leave: 0, offline: 0 };
  avail.rows.forEach((u) => { byStatus[u.status] += 1; });
  const openValue = pipeline.rows.reduce((s, r) => s + Number(r.value_cents), 0);
  const figures = {
    new_leads_today: newLeads.rows[0].n,
    open_leads: openLeads.rows[0].n,
    open_pipeline_by_stage: pipeline.rows.map((r) => ({ ...r, value_cents: canValues ? Number(r.value_cents) : null })),
    open_pipeline_cents: canValues ? openValue : null,
    avg_first_response_seconds: firstResp.rows[0].secs === null ? null : Math.round(firstResp.rows[0].secs),
    first_responses_counted: firstResp.rows[0].n,
    recovery_count: recov.rows[0].n,
    escalations_24h: esc.rows[0].n,
    manual_reassignments_24h: manual.rows[0].n,
    availability: { counts: byStatus, users: avail.rows },
    upcoming_appointments: appts.rows,
    collected_this_month_cents: canValues ? Number(collected.rows[0].cents) : null,
    collected_payments_count: collected.rows[0].n,
    projected_cents: canValues ? openValue + Number(pendingPay.rows[0].cents) : null,
    currency: collected.rows[0].currency || 'PKR',
  };
  return {
    scope: personal ? 'personal' : 'company',
    figures,
    hidden: Array.isArray(req.user.prefs?.dashboard_hidden) ? req.user.prefs.dashboard_hidden : [],
    drilldowns: {
      new_leads_today: '/leads?scope=all&created=today', recovery_count: '/recovery', escalations_24h: '/leads?scope=all&escalated=24h',
      open_pipeline_by_stage: '/opportunities?stage_id=', collected_this_month_cents: '/payments?status=paid&period=this_month', availability: '/settings/users',
    },
    definitions: {
      new_leads_today: 'Leads created today (your timezone).',
      open_pipeline_by_stage: 'Sum of values of opportunities in open (not won/lost) stages, by stage.',
      avg_first_response_seconds: 'Average time from a lead\'s first assignment to its first acknowledgement, last 30 days.',
      recovery_count: 'Leads unacknowledged past their window, escalated 2+ times, unassigned, or idle beyond the configured period.',
      escalations_24h: 'Automatic reassignments caused by an expired acknowledgement window in the last 24 hours (manual reassignments counted separately).',
      collected_this_month_cents: 'Payments verified through Google Pay this month, minus refunds.',
      projected_cents: 'Open pipeline value plus unpaid payment requests.',
    },
  };
}

module.exports = { dashboard };
