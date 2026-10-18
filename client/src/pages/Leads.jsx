// Leads — owner: Ali (F3.1, F3.3–F3.6, Q11). Mine/All, live countdowns, acknowledge, reassign, manual entry.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPost, qs } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useCan } from '../hooks/useCan';
import { relative } from '../utils/format';
import { Badge, Button, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Textarea } from '../components/ui';
import Countdown from '../components/Countdown';

export const SOURCE_LABEL = { web_form: 'Web form', telegram: 'Telegram', whatsapp: 'WhatsApp', manual: 'Manual' };
const STATUS = {
  assigned: { label: 'Waiting for acknowledgement', tone: 'yellow' },
  acknowledged: { label: 'Acknowledged', tone: 'green' },
  unassigned: { label: 'No owner', tone: 'red' },
  closed: { label: 'Closed', tone: 'gray' },
};
export function LeadStatus({ status }) {
  const s = STATUS[status] || { label: status, tone: 'gray' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Reassign a lead to someone else (leads.reassign). Shared by Leads, LeadDetail and Recovery. */
export function ReassignModal({ lead, onClose, onDone }) {
  const { data: users } = useSWR(lead ? '/users' : null, apiGet);
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  if (!lead) return null;
  const options = (users?.data || [])
    .filter((u) => u.id !== lead.owner_id)
    .map((u) => ({
      value: u.id,
      label: `${u.name} · ${{ available: 'Available', busy: 'Busy', on_leave: 'On leave', offline: 'Offline' }[u.status] || u.status} · ${u.open_leads ?? 0} open`,
      disabled: u.status === 'on_leave' || u.status === 'offline',
    }));
  const submit = async () => {
    setBusy(true);
    try {
      await apiPost(`/leads/${lead.id}/reassign`, { user_id: userId, version: lead.version });
      toast.success('Lead reassigned. The new owner has been alerted.');
      onDone?.();
      onClose();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Reassign ${lead.contact_name}`} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button onClick={submit} loading={busy} disabled={!userId}>Reassign</Button>
    </>}>
      <p className="mb-3 text-sm text-slate-600">
        Currently {lead.owner_name ? <strong>{lead.owner_name}</strong> : 'nobody'}. The new owner gets a fresh acknowledgement timer and a Telegram alert. People on leave or offline can't be picked.
      </p>
      <Field label="New owner" required>
        <Select placeholder="Choose a person…" value={userId} onChange={(e) => setUserId(e.target.value)} options={options} />
      </Field>
    </Modal>
  );
}

function NewLeadModal({ open, onClose, onDone }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', note: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      const { data } = await apiPost('/leads', f);
      toast.success(data.owner_id ? 'Lead created and assigned' : 'Lead created — nobody is available, so it went to the recovery queue');
      setF({ name: '', phone: '', email: '', note: '' });
      onDone?.(data);
      onClose();
    } catch (err) { setErrors(err.details || {}); toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New lead" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="submit" form="new-lead" loading={busy}>Create lead</Button>
    </>}>
      <form id="new-lead" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Field label="Name" required error={errors.name}><Input value={f.name} onChange={set('name')} autoComplete="off" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone" error={errors.phone} hint="If this number exists, the lead joins that contact"><Input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
          <Field label="Email" error={errors.email}><Input type="email" value={f.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Note" error={errors.note}><Textarea rows={3} value={f.note} onChange={set('note')} placeholder="What do they want?" /></Field>
      </form>
    </Modal>
  );
}

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Waiting for acknowledgement' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'unassigned', label: 'No owner' },
  { value: 'closed', label: 'Closed' },
  { value: 'any', label: 'All statuses' },
];

export default function Leads() {
  const { user } = useAuth();
  const can = useCan();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') === 'all' && can('leads.view_all') ? 'all' : 'mine';
  const filter = params.get('status') || (scope === 'all' ? 'any' : 'open');
  const page = Number(params.get('page')) || 1;
  const [newOpen, setNewOpen] = useState(false);
  const [reassign, setReassign] = useState(null);
  const [acking, setAcking] = useState(null);

  const statusParam = filter === 'open' ? 'assigned,acknowledged' : filter === 'any' ? '' : filter;
  const key = `/leads${qs({
    scope, status: statusParam, page, limit: 25,
    created: params.get('created') || '', escalated: params.get('escalated') || '', q: params.get('q') || '',
  })}`;
  const { data, error, isLoading, mutate } = useSWR(key, apiGet, { refreshInterval: 3000 });
  const { data: rules } = useSWR('/assignment-rules', apiGet);

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };

  const ack = async (lead, e) => {
    e.stopPropagation();
    setAcking(lead.id);
    try { await apiPost(`/leads/${lead.id}/ack`); toast.success(`You've acknowledged ${lead.contact_name}`); mutate(); } catch (err) { toast.error(err.message); } finally { setAcking(null); }
  };

  const drill = params.get('created') === 'today' ? 'Created today' : params.get('escalated') === '24h' ? 'Escalated in the last 24 hours' : null;

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle={scope === 'mine' ? 'Leads you’re accountable for. Acknowledge each one before its timer runs out.' : 'Every lead in the workspace and who owns it right now.'}
        actions={can('crm.create') && <Button onClick={() => setNewOpen(true)}>+ New lead</Button>}
      />

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div role="tablist" aria-label="Whose leads" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {[['mine', 'Mine'], ...(can('leads.view_all') ? [['all', 'Everyone']] : [])].map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={scope === v}
              onClick={() => { const n = new URLSearchParams(); if (v === 'all') n.set('scope', 'all'); setParams(n); }}
              className={`rounded-md px-3 py-1.5 font-medium ${scope === v ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Search" className="w-48"><Input type="search" placeholder="Name, phone, email" defaultValue={params.get('q') || ''} onKeyDown={(e) => { if (e.key === 'Enter') setParam('q', e.currentTarget.value.trim()); }} /></Field>
          <Field label="Status" className="w-56"><Select value={filter} onChange={(e) => setParam('status', e.target.value)} options={FILTERS} /></Field>
        </div>
      </div>

      {drill && (
        <p className="mb-3 flex items-center gap-2 text-sm text-slate-600">
          Showing: <Badge tone="blue">{drill}</Badge>
          <button type="button" className="text-primary underline" onClick={() => { setParam('created', ''); setParam('escalated', ''); }}>Clear</button>
        </p>
      )}

      <DataTable
        loading={isLoading}
        error={error}
        rows={data?.data}
        onRowClick={(l) => nav(`/leads/${l.id}`)}
        empty={<EmptyState icon="✅" title={scope === 'mine' ? 'No open leads on your plate' : 'No leads match'} body={scope === 'mine' ? 'New leads appear here the moment they’re assigned to you — you’ll also get a pop-up.' : undefined} />}
        columns={[
          { key: 'contact_name', label: 'Lead', render: (l) => (
            <div>
              <p className="font-medium text-slate-900">{l.contact_name}</p>
              <p className="text-xs text-slate-500">{l.contact_phone || l.contact_email || '—'}</p>
            </div>
          ) },
          { key: 'source', label: 'Source', render: (l) => <span className="text-sm">{SOURCE_LABEL[l.source] || l.source}</span> },
          { key: 'status', label: 'Status', render: (l) => <LeadStatus status={l.status} /> },
          { key: 'owner_name', label: 'Owner', render: (l) => (l.owner_name ? (l.owner_id === user?.id ? <strong>You</strong> : l.owner_name) : <span className="text-red-700">Nobody</span>) },
          { key: 'timer', label: 'Time left', render: (l) => (l.status === 'assigned' ? <Countdown secondsLeft={l.seconds_left} /> : <span className="text-slate-400">—</span>) },
          { key: 'esc', label: 'Escalations', render: (l) => (l.escalation_count ? <Badge tone={l.escalation_count >= 2 ? 'red' : 'yellow'}>{l.escalation_count}×</Badge> : <span className="text-slate-400">0</span>) },
          { key: 'created_at', label: 'Came in', render: (l) => <span className="whitespace-nowrap text-xs text-slate-500">{relative(l.created_at)}</span> },
          { key: 'actions', label: <span className="sr-only">Actions</span>, render: (l) => (
            <div className="flex flex-wrap gap-1.5">
              {l.status === 'assigned' && l.owner_id === user?.id && (
                <Button size="sm" loading={acking === l.id} onClick={(e) => ack(l, e)}>Acknowledge</Button>
              )}
              {can('leads.reassign') && l.status !== 'closed' && (
                <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setReassign(l); }}>Reassign</Button>
              )}
            </div>
          ) },
        ]}
      />
      <Pagination page={page} limit={25} total={data?.total || 0} onChange={(p) => setParam('page', String(p))} />

      {rules?.data && (
        <p className="mt-4 text-xs text-slate-500">
          If an owner goes on leave or offline, leads they haven’t acknowledged move to a colleague straight away. Leads they’ve already acknowledged
          {rules.data.on_absence_acknowledged === 'reassign' ? ' move too.' : ' stay with them, and show up in the recovery queue if nobody acts on them.'}
        </p>
      )}

      <NewLeadModal open={newOpen} onClose={() => setNewOpen(false)} onDone={() => mutate()} />
      <ReassignModal lead={reassign} onClose={() => setReassign(null)} onDone={() => mutate()} />
    </div>
  );
}
