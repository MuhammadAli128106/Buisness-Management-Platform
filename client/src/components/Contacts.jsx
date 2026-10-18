// Ahmed — Contacts list, create/edit modal, filters, CSV export (F2.1, F2.2, F2.6, Q9).
import { useState } from 'react';
import useSWR from 'swr';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost, downloadFile, qs } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useCan } from '../hooks/useCan';
import { dateOnly } from '../utils/format';
import { Badge, Button, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select } from '../components/ui';
import FilterBar from '../components/FilterBar';
import CustomFieldInputs from '../components/CustomFieldInputs';

const LIMIT = 25;
const blank = (ownerId) => ({ name: '', email: '', phone: '', company_id: '', owner_id: ownerId || '', tags: '', custom: {} });

export default function Contacts() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const can = useCan();
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null); // null | { id?, version?, form }
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(`/contacts${qs({ ...filters, page, limit: LIMIT })}`, apiGet, { keepPreviousData: true });
  const { data: defsRes } = useSWR('/custom-fields?entity=contact', apiGet);
  const { data: companiesRes } = useSWR(modal ? '/companies?limit=100' : null, apiGet);
  const { data: usersRes } = useSWR(modal ? '/users' : null, apiGet);
  const rows = data?.data;
  const defs = defsRes?.data || [];
  const hasFilters = Object.keys(filters).length > 0;

  const applyFilters = (f) => { setFilters(f); setPage(1); };
  const openNew = () => { setErrors({}); setModal({ form: blank(user?.id) }); };
  const openEdit = (c) => {
    setErrors({});
    setModal({
      id: c.id, version: c.version,
      form: { name: c.name || '', email: c.email || '', phone: c.phone || '', company_id: c.company_id || '', owner_id: c.owner_id || '', tags: (c.tags || []).join(', '), custom: c.custom || {} },
    });
  };
  const setForm = (patch) => setModal((m) => ({ ...m, form: { ...m.form, ...patch } }));

  const save = async (e) => {
    e.preventDefault();
    const f = modal.form;
    setBusy(true); setErrors({});
    const body = {
      name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() || null,
      company_id: f.company_id || null, owner_id: f.owner_id || null,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), custom: f.custom,
    };
    try {
      if (modal.id) await apiPatch(`/contacts/${modal.id}`, { ...body, version: modal.version });
      else await apiPost('/contacts', body);
      toast.success(modal.id ? 'Contact updated' : 'Contact created');
      setModal(null);
      mutate();
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
      if (err.status === 409 && err.body?.current) { setModal(null); mutate(); } // someone else edited it
    } finally { setBusy(false); }
  };

  const exportCsv = async () => {
    setExporting(true);
    try { await downloadFile(`/export/contacts.csv${qs(filters)}`, 'contacts.csv'); } catch (err) { toast.error(err.message); } finally { setExporting(false); }
  };

  const columns = [
    {
      key: 'name', label: 'Name',
      render: (c) => (
        <div>
          <p className="font-medium text-slate-900">{c.name}{c.opted_out && <Badge tone="red" className="ml-2">Opted out</Badge>}</p>
          {c.email && <p className="break-all text-xs text-slate-500">{c.email}</p>}
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', render: (c) => c.phone || '—' },
    { key: 'company_name', label: 'Company', render: (c) => c.company_name || '—' },
    { key: 'tags', label: 'Tags', render: (c) => (c.tags?.length ? <span className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span> : '—') },
    { key: 'owner_name', label: 'Owner', render: (c) => c.owner_name || 'Unassigned' },
    { key: 'created_at', label: 'Created', render: (c) => dateOnly(c.created_at) },
    {
      key: 'actions', label: <span className="sr-only">Actions</span>,
      render: (c) => (can('crm.edit') ? <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); openEdit(c); }}>Edit</Button></div> : null),
    },
  ];

  const empty = hasFilters
    ? <EmptyState title="No contacts match these filters" body="Try removing a filter or clearing them all." />
    : <EmptyState title="No contacts yet" body="Add your first contact to get started." action={can('crm.create') && <Button onClick={openNew}>+ New contact</Button>} />;

  const form = modal?.form;
  return (
    <div>
      <PageHeader title="Contacts" subtitle="People you sell to and talk with."
        actions={(
          <div className="flex flex-wrap gap-2">
            {can('crm.export') && <Button variant="secondary" loading={exporting} onClick={exportCsv}>Export CSV</Button>}
            {can('crm.create') && <Button onClick={openNew}>+ New contact</Button>}
          </div>
        )} />

      <FilterBar entity="contact" value={filters} onChange={applyFilters} />
      <DataTable columns={columns} rows={rows} loading={isLoading} error={error} empty={empty} onRowClick={(c) => navigate(`/contacts/${c.id}`)} />
      <Pagination page={page} limit={LIMIT} total={data?.total || 0} onChange={setPage} />

      <Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal?.id ? 'Edit contact' : 'New contact'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" form="contact-form" loading={busy}>{modal?.id ? 'Save changes' : 'Create contact'}</Button></>}>
        {form && (
          <form id="contact-form" onSubmit={save} className="flex flex-col gap-3">
            <Field label="Full name" required error={errors.name}><Input value={form.name} onChange={(e) => setForm({ name: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email" error={errors.email}><Input type="email" value={form.email} onChange={(e) => setForm({ email: e.target.value })} /></Field>
              <Field label="Phone" error={errors.phone} hint="International format, e.g. +923001234567"><Input type="tel" value={form.phone} onChange={(e) => setForm({ phone: e.target.value })} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company" error={errors.company_id}>
                <Select placeholder="No company" value={form.company_id} onChange={(e) => setForm({ company_id: e.target.value })}
                  options={(companiesRes?.data || []).map((c) => ({ value: c.id, label: c.name }))} />
              </Field>
              <Field label="Owner" error={errors.owner_id}>
                <Select placeholder="Unassigned" value={form.owner_id} onChange={(e) => setForm({ owner_id: e.target.value })}
                  options={(usersRes?.data || []).map((u) => ({ value: u.id, label: u.name }))} />
              </Field>
            </div>
            <Field label="Tags" error={errors.tags} hint="Separate with commas"><Input value={form.tags} onChange={(e) => setForm({ tags: e.target.value })} /></Field>
            <CustomFieldInputs fields={defs} value={form.custom} onChange={(custom) => setForm({ custom })} errors={errors} />
          </form>
        )}
      </Modal>
    </div>
  );
}
