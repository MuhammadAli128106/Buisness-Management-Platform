// Ahmed — live dashboard (F5.1–F5.5). GET /dashboard every 10 s. Response: { data: { scope, figures:{key:value}, hidden:[keys] } }.
// Cards with a drill-down are clickable (routes from CLAUDE.md §11). "Customize" shows/hides cards via PUT /me/prefs.
import { useState } from 'react';
import useSWR from 'swr';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { apiGet, apiPut } from '../utils/api';
import { useCan } from '../hooks/useCan';
import { dateTime, duration, money, STATUS_LABELS } from '../utils/format';
import { Badge, Button, Checkbox, EmptyState, PageHeader, Spinner, StatCard } from '../components/ui';

const CARDS = [
  ['new_leads_today', 'New leads today'], ['recovery_count', 'Needs recovery'], ['escalations_24h', 'Escalations (24 h)'],
  ['avg_first_response_seconds', 'Avg first response'], ['collected_this_month_cents', 'Collected this month'], ['projected_cents', 'Projected'],
  ['open_pipeline_by_stage', 'Open pipeline by stage'], ['availability', 'Team availability'], ['upcoming_appointments', 'Upcoming appointments'],
];
const STATUS_TONE = { available: 'green', busy: 'yellow', on_leave: 'purple', offline: 'gray' };
const num = (v) => (v === null || v === undefined ? '—' : v);

function stageRows(v) {
  // API rows: { stage_id, stage, pipeline, count, value_cents } — value_cents is null on every row when values are hidden (F1.4)
  const arr = Array.isArray(v) ? v : [];
  const multi = new Set(arr.map((x) => x.pipeline)).size > 1;
  const rows = arr.map((x) => ({
    id: x.stage_id, name: multi && x.pipeline ? `${x.pipeline} · ${x.stage}` : x.stage || 'Stage',
    cents: x.value_cents === null || x.value_cents === undefined ? null : Number(x.value_cents), count: x.count,
  }));
  return { rows, masked: rows.length > 0 && rows.every((r) => r.cents === null) };
}
function teamRows(v) {
  const users = Array.isArray(v) ? v : v?.users || v?.list || [];
  const counts = !Array.isArray(v) && v?.counts ? v.counts : users.reduce((m, u) => ({ ...m, [u.status]: (m[u.status] || 0) + 1 }), {});
  return { users, counts };
}

export default function Dashboard() {
  const navigate = useNavigate();
  const can = useCan();
  const { data, error, isLoading, mutate } = useSWR('/dashboard', apiGet, { refreshInterval: 10000 });
  const [customizing, setCustomizing] = useState(false);
  const [saving, setSaving] = useState(false);

  const d = data?.data;
  const figures = d?.figures || {};
  const hidden = new Set(d?.hidden || []);
  const show = (k) => !hidden.has(k);

  const toggle = async (key) => {
    const next = hidden.has(key) ? [...hidden].filter((k) => k !== key) : [...hidden, key];
    setSaving(true);
    try { await apiPut('/me/prefs', { dashboard_hidden: next }); await mutate(); } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  if (error && !data) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Couldn&apos;t load the dashboard: {error.message}</div>;
  if (isLoading && !data) return <div className="flex justify-center p-10"><Spinner label="Loading dashboard" /></div>;

  const { rows: stages, masked } = stageRows(figures.open_pipeline_by_stage);
  const cur = figures.currency || 'USD';
  const dd = d?.drilldowns || {};
  const m = (cents) => money(cents, cur);
  const { users, counts } = teamRows(figures.availability);
  const appts = figures.upcoming_appointments || [];
  const chartData = stages.map((s) => ({ ...s, amount: (s.cents || 0) / 100 }));
  const stageLink = (id) => `${dd.open_pipeline_by_stage || '/opportunities?stage_id='}${id}`;
  const drillStage = (id) => id && navigate(stageLink(id));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={d?.scope === 'personal' ? 'Your numbers' : 'Company-wide'}
        actions={<Button variant="secondary" onClick={() => setCustomizing((c) => !c)}>{customizing ? 'Done' : 'Customize'}</Button>} />

      {customizing && (
        <fieldset disabled={saving} className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">Show on my dashboard</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CARDS.map(([k, label]) => <Checkbox key={k} label={label} checked={show(k)} onChange={() => toggle(k)} />)}
          </div>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {show('new_leads_today') && <StatCard icon="🆕" label="New leads today" value={num(figures.new_leads_today)} onClick={() => navigate(dd.new_leads_today || '/leads?scope=all&created=today')} />}
        {show('recovery_count') && <StatCard icon="🛟" label="Needs recovery" value={num(figures.recovery_count)} hint="Unassigned, overdue or stuck leads" onClick={() => navigate(dd.recovery_count || '/recovery')} />}
        {show('escalations_24h') && (
          <StatCard icon="⚠️" label="Escalations (24 h)" value={num(figures.escalations_24h)}
            hint={figures.manual_reassignments_24h !== undefined ? `${figures.manual_reassignments_24h} manual reassignments` : undefined}
            onClick={() => navigate(dd.escalations_24h || '/leads?scope=all&escalated=24h')} />
        )}
        {show('avg_first_response_seconds') && <StatCard icon="⏱️" label="Avg first response" value={duration(figures.avg_first_response_seconds)} hint={figures.first_responses_counted !== undefined ? `Last 30 days · ${figures.first_responses_counted} responses` : 'Last 30 days'} />}
        {show('collected_this_month_cents') && <StatCard icon="💰" label="Collected this month" value={m(figures.collected_this_month_cents)} hint="Verified payments, minus refunds" onClick={() => navigate(dd.collected_this_month_cents || '/payments?status=paid&period=this_month')} />}
        {show('projected_cents') && <StatCard icon="📈" label="Projected" value={m(figures.projected_cents)} hint="Open pipeline + pending payment requests" />}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {show('open_pipeline_by_stage') && (
          <section aria-labelledby="pipe-h" className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
            <h2 id="pipe-h" className="font-semibold text-slate-900">Open pipeline by stage</h2>
            {stages.length === 0 && <p className="mt-2 text-sm text-slate-500">No open stages yet.</p>}
            {stages.length > 0 && masked && (
              <>
                <p className="mt-2 text-sm text-slate-500">Pipeline values are hidden for your role. Opportunities per stage:</p>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {stages.map((s) => <li key={s.id}><Link className="text-primary hover:underline" to={stageLink(s.id)}>{s.name}</Link>: <strong>{s.count}</strong></li>)}
                </ul>
              </>
            )}
            {stages.length > 0 && !masked && (
              <>
                <div className="mt-3 h-64 w-full" role="img" aria-label={`Open pipeline value by stage: ${stages.map((s) => `${s.name} ${m(s.cents)}`).join(', ')}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} />
                      <YAxis tick={{ fontSize: 12 }} width={64} tickFormatter={(v) => m(v * 100)} />
                      <Tooltip formatter={(v) => m(v * 100)} />
                      <Bar dataKey="amount" fill="#2563eb" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(e) => drillStage(e?.payload?.id ?? e?.id)} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {stages.map((s) => (
                    <li key={s.id}><Link className="text-primary hover:underline" to={stageLink(s.id)}>{s.name}</Link>: <strong>{m(s.cents)}</strong>{s.count !== undefined && <span className="text-slate-500"> ({s.count})</span>}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {show('availability') && (
          <section aria-labelledby="avail-h" className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 id="avail-h" className="font-semibold text-slate-900">Team availability</h2>
              {can('users.manage') && <Link className="text-sm text-primary hover:underline" to="/settings/users">Manage →</Link>}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(STATUS_LABELS).map(([k, label]) => <Badge key={k} tone={STATUS_TONE[k]}>{label}: {counts[k] || 0}</Badge>)}
            </div>
            {users.length === 0 ? <p className="mt-3 text-sm text-slate-500">No team members to show.</p> : (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {users.map((u) => (
                  <li key={u.id || u.name} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="truncate text-slate-800">{u.name}{u.open_leads !== undefined && <span className="text-slate-500"> · {u.open_leads} open leads</span>}</span>
                    <Badge tone={STATUS_TONE[u.status]}>{STATUS_LABELS[u.status] || u.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {show('upcoming_appointments') && (
          <section aria-labelledby="appt-h" className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 id="appt-h" className="font-semibold text-slate-900">Upcoming appointments</h2>
            {appts.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing booked yet.</p> : (
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {appts.map((a) => (
                  <li key={a.id} className="py-2">
                    <Link className="font-medium text-slate-900 hover:text-primary hover:underline" to={a.contact_id ? `/contacts/${a.contact_id}` : '/contacts'}>{a.title}</Link>
                    <p className="text-xs text-slate-500">{dateTime(a.starts_at)}{(a.contact_name || a.user_name) && ` · ${[a.contact_name, a.user_name].filter(Boolean).join(' · ')}`}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {CARDS.every(([k]) => !show(k)) && <div className="mt-4"><EmptyState title="Everything is hidden" body="Use Customize to show some cards again." /></div>}
    </div>
  );
}
