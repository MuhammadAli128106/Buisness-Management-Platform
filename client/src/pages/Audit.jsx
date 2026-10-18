// Audit log — owner: Musa (F4.2, F4.3). Read-only by design: no edit or delete anywhere.
import { useState } from 'react';
import useSWR from 'swr';
import { apiGet, qs } from '../utils/api';
import { dateTime } from '../utils/format';
import { Badge, DataTable, Field, Input, PageHeader, Pagination, Select } from '../components/ui';

function Diff({ before, after }) {
  if (!before && !after) return <span className="text-slate-400">—</span>;
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].slice(0, 6);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
      {keys.map((k) => (
        <div key={k} className="contents">
          <dt className="font-medium text-slate-500">{k}</dt>
          <dd className="break-all">
            {before && k in before && <span className="text-red-700 line-through">{JSON.stringify(before[k])}</span>}{before && k in before && after && k in after && ' → '}
            {after && k in after && <span className="text-emerald-700">{JSON.stringify(after[k])}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function Audit() {
  const [f, setF] = useState({ event_type: '', user_id: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useSWR(`/audit${qs({ ...f, page, limit: 30 })}`, apiGet, { refreshInterval: 5000 });
  const users = useSWR('/users', apiGet);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every important action with who, when and what changed. Entries cannot be edited or deleted — the database itself refuses." />
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Event type"><Select value={f.event_type} onChange={set('event_type')} placeholder="All events" options={(data?.event_types || []).map((t) => ({ value: t, label: t }))} /></Field>
        <Field label="Who"><Select value={f.user_id} onChange={set('user_id')} placeholder="Anyone" options={[{ value: 'system', label: 'System (automatic)' }, ...(users.data?.data || []).map((u) => ({ value: u.id, label: u.name }))]} /></Field>
        <Field label="From"><Input type="date" value={f.from} onChange={set('from')} /></Field>
        <Field label="To"><Input type="date" value={f.to} onChange={set('to')} /></Field>
      </div>
      <DataTable loading={isLoading} error={error} rows={data?.data} empty="No audit entries match" columns={[
        { key: 'created_at', label: 'When', render: (a) => <span className="whitespace-nowrap">{dateTime(a.created_at)}</span> },
        { key: 'actor_name', label: 'Who', render: (a) => (a.actor_id ? a.actor_name : <Badge tone="purple">System</Badge>) },
        { key: 'event_type', label: 'Event', render: (a) => <code className="text-xs">{a.event_type}</code> },
        { key: 'target', label: 'Target', render: (a) => <span className="text-xs">{a.target_type}{a.target_id ? ` · ${String(a.target_id).slice(0, 8)}` : ''}</span> },
        { key: 'change', label: 'Before → after', render: (a) => <Diff before={a.before} after={a.after} /> },
      ]} />
      <Pagination page={page} limit={30} total={data?.total || 0} onChange={setPage} />
    </div>
  );
}
