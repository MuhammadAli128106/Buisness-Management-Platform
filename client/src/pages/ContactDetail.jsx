// Ahmed — contact detail (F2.8, I1.9). GET /contacts/:id/full. Details (+edit, opt-out with reason), assigned employee,
// opportunities, conversation / payments / appointments panels, add-note box, activity timeline.
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost, qs } from '../utils/api';
import { useCan } from '../hooks/useCan';
import { dateOnly, money, STATUS_LABELS } from '../utils/format';
import { Badge, Button, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui';
import ActivityTimeline from '../components/ActivityTimeline';
import AppointmentsPanel from '../components/AppointmentsPanel';
import ConversationPanel from '../components/ConversationPanel';
import CustomFieldInputs from '../components/CustomFieldInputs';
import OpportunityFormModal from '../components/OpportunityFormModal';
import PaymentsPanel from '../components/PaymentsPanel';

const STATUS_TONE = { available: 'green', busy: 'yellow', on_leave: 'purple', offline: 'gray' };
const KIND_TONE = { open: 'blue', won: 'green', lost: 'red' };
const customText = (def, v) => {
  if (v === undefined || v === null || v === '') return '—';
  if (def.type === 'checkbox') return v === true || v === 'true' ? 'Yes' : 'No';
  if (def.type === 'date') return dateOnly(v);
  return String(v);
};

export default function ContactDetail() {
  const { id } = useParams();
  const can = useCan();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, error, isLoading, mutate } = useSWR(`/contacts/${id}/full`, apiGet);
  const { data: defsRes } = useSWR('/custom-fields?entity=contact', apiGet);
  const { data: pipesRes } = useSWR('/pipelines', apiGet);

  const [editing, setEditing] = useState(null);
  const [optOut, setOptOut] = useState(null); // { reason }
  const [oppOpen, setOppOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  const { data: companiesRes } = useSWR(editing ? '/companies?limit=100' : null, apiGet);
  const { data: usersRes } = useSWR(editing ? '/users' : null, apiGet);

  const refresh = () => { mutate(); globalMutate(`/activities${qs({ contact_id: id })}`); };

  if (error) return <EmptyState icon="🔍" title="Couldn't open this contact" body={error.message} action={<Link to="/contacts" className="text-primary hover:underline">← Back to contacts</Link>} />;
  if (isLoading || !data) return <div className="flex justify-center p-10"><Spinner label="Loading contact" /></div>;

  const { contact: c, company, opportunities = [], assigned_user: assigned } = data.data;
  const defs = defsRes?.data || [];
  const setForm = (p) => setEditing((e) => ({ ...e, ...p }));

  const openEdit = () => {
    setErrors({});
    setEditing({ name: c.name || '', email: c.email || '', phone: c.phone || '', company_id: c.company_id || '', owner_id: c.owner_id || '', tags: (c.tags || []).join(', '), custom: c.custom || {} });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      await apiPatch(`/contacts/${c.id}`, {
        name: editing.name.trim(), email: editing.email.trim(), phone: editing.phone.trim() || null, company_id: editing.company_id || null,
        owner_id: editing.owner_id || null, tags: editing.tags.split(',').map((t) => t.trim()).filter(Boolean), custom: editing.custom, version: c.version,
      });
      toast.success('Contact updated'); setEditing(null); refresh();
    } catch (err) { setErrors(err.details || {}); toast.error(err.message); if (err.status === 409) { setEditing(null); refresh(); } } finally { setBusy(false); }
  };

  const setOptedOut = async (value, reason) => {
    setBusy(true);
    try {
      await apiPatch(`/contacts/${c.id}`, { opted_out: value, ...(value ? { opted_out_reason: reason } : {}), version: c.version });
      toast.success(value ? 'Contact opted out of messaging' : 'Messaging re-enabled');
      setOptOut(null); refresh();
    } catch (err) { toast.error(err.message); if (err.status === 409) refresh(); } finally { setBusy(false); }
  };

  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) { setNoteErr('Write something first'); return; }
    setBusy(true); setNoteErr('');
    try { await apiPost('/notes', { contact_id: c.id, body: note.trim() }); setNote(''); toast.success('Note added'); refresh(); } catch (err) { setNoteErr(err.details?.body || err.message); toast.error(err.message); } finally { setBusy(false); }
  };

  const oppColumns = [
    { key: 'title', label: 'Opportunity', render: (o) => <Link to={`/opportunities/${o.id}`} className="font-medium text-slate-900 hover:text-primary hover:underline">{o.title}</Link> },
    { key: 'stage_name', label: 'Stage', render: (o) => <span className="flex items-center gap-1">{o.stage_name}<Badge tone={KIND_TONE[o.stage_kind]}>{o.stage_kind}</Badge></span> },
    { key: 'value', label: 'Value', render: (o) => (o.value_masked ? <Badge>Hidden</Badge> : money(o.value_cents, o.currency)) },
  ];

  const detail = (label, value) => (<div><dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt><dd className="break-words text-sm text-slate-900">{value || '—'}</dd></div>);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={c.name} subtitle={company ? `at ${company.name}` : 'No company'}
        actions={<><Link to="/contacts" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">← Contacts</Link>{can('crm.edit') && <Button onClick={openEdit}>Edit</Button>}</>} />

      {c.opted_out && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <strong>Opted out of messaging.</strong> {c.opted_out_reason && <>Reason: {c.opted_out_reason}</>}
        </p>
      )}

      <section aria-labelledby="det-h" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="det-h" className="mb-3 font-semibold text-slate-900">Details</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {detail('Email', c.email)}{detail('Phone', c.phone)}{detail('Company', company?.name)}
          {detail('Owner', c.owner_name)}{detail('Source', c.source)}{detail('Created', dateOnly(c.created_at))}
          {detail('Tags', c.tags?.length ? <span className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span> : null)}
          {defs.map((def) => <div key={def.id}>{detail(def.label, customText(def, c.custom?.[def.key]))}</div>)}
        </dl>
        {can('crm.edit') && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <Checkbox label="Opted out of messaging" checked={Boolean(c.opted_out)} disabled={busy}
              onChange={(e) => (e.target.checked ? setOptOut({ reason: '' }) : setOptedOut(false))} />
          </div>
        )}
      </section>

      <section aria-labelledby="asg-h" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="asg-h" className="mb-2 font-semibold text-slate-900">Assigned employee</h2>
        {assigned ? <p className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium text-slate-900">{assigned.name}</span><span className="text-slate-500">{assigned.email}</span><Badge tone={STATUS_TONE[assigned.status]}>{STATUS_LABELS[assigned.status] || assigned.status}</Badge></p>
          : <p className="text-sm text-slate-500">Nobody is assigned yet.</p>}
      </section>

      <section aria-labelledby="opp-h">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="opp-h" className="font-semibold text-slate-900">Opportunities</h2>
          {can('crm.create') && <Button size="sm" variant="secondary" onClick={() => setOppOpen(true)}>+ New opportunity</Button>}
        </div>
        <DataTable columns={oppColumns} rows={opportunities} empty="No opportunities for this contact yet" />
      </section>

      <ConversationPanel contactId={c.id} />
      <PaymentsPanel contactId={c.id} />
      <AppointmentsPanel contactId={c.id} />

      <section aria-labelledby="note-h" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="note-h" className="mb-2 font-semibold text-slate-900">Add a note</h2>
        <form onSubmit={addNote} className="flex flex-col gap-2">
          <Field label="Note" error={noteErr}><Textarea value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} /></Field>
          <div><Button type="submit" loading={busy} disabled={!can('crm.edit')}>Add note</Button></div>
        </form>
      </section>

      <ActivityTimeline contactId={c.id} />

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit contact" size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="contact-edit" loading={busy}>Save changes</Button></>}>
        {editing && (
          <form id="contact-edit" onSubmit={save} className="flex flex-col gap-3">
            <Field label="Full name" required error={errors.name}><Input value={editing.name} onChange={(e) => setForm({ name: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email" error={errors.email}><Input type="email" value={editing.email} onChange={(e) => setForm({ email: e.target.value })} /></Field>
              <Field label="Phone" error={errors.phone} hint="International format, e.g. +923001234567"><Input type="tel" value={editing.phone} onChange={(e) => setForm({ phone: e.target.value })} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company" error={errors.company_id}><Select placeholder="No company" value={editing.company_id} onChange={(e) => setForm({ company_id: e.target.value })} options={(companiesRes?.data || []).map((x) => ({ value: x.id, label: x.name }))} /></Field>
              <Field label="Owner" error={errors.owner_id}><Select placeholder="Unassigned" value={editing.owner_id} onChange={(e) => setForm({ owner_id: e.target.value })} options={(usersRes?.data || []).map((u) => ({ value: u.id, label: u.name }))} /></Field>
            </div>
            <Field label="Tags" error={errors.tags} hint="Separate with commas"><Input value={editing.tags} onChange={(e) => setForm({ tags: e.target.value })} /></Field>
            <CustomFieldInputs fields={defs} value={editing.custom} onChange={(custom) => setForm({ custom })} errors={errors} />
          </form>
        )}
      </Modal>

      <Modal open={Boolean(optOut)} onClose={() => setOptOut(null)} title="Opt out of messaging" size="sm"
        footer={<><Button variant="secondary" onClick={() => setOptOut(null)}>Cancel</Button><Button variant="danger" loading={busy} disabled={!optOut?.reason.trim()} onClick={() => setOptedOut(true, optOut.reason.trim())}>Opt out</Button></>}>
        {optOut && <Field label="Reason" required hint="Messages to this contact will be blocked"><Input value={optOut.reason} maxLength={300} onChange={(e) => setOptOut({ reason: e.target.value })} /></Field>}
      </Modal>

      <OpportunityFormModal open={oppOpen} onClose={() => setOppOpen(false)} pipelines={pipesRes?.data || []} defaultContactId={c.id} onSaved={refresh} />
    </div>
  );
}
