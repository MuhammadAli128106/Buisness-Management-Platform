// Ahmed — Companies list + create/edit modal; shows contact count (F2.1).
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost, qs } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useCan } from '../hooks/useCan';
import { dateOnly } from '../utils/format';
import { Button, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select } from '../components/ui';
import FilterBar from '../components/FilterBar';
import CustomFieldInputs from '../components/CustomFieldInputs';

const LIMIT = 25;

export default function Companies() {
  const { user } = useAuth();
  const can = useCan();
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(`/companies${qs({ ...filters, page, limit: LIMIT })}`, apiGet, { keepPreviousData: true });
  const { data: defsRes } = useSWR('/custom-fields?entity=company', apiGet);
  const { data: usersRes } = useSWR(modal ? '/users' : null, apiGet);
  const defs = defsRes?.data || [];
  const hasFilters = Object.keys(filters).length > 0;

  const applyFilters = (f) => { setFilters(f); setPage(1); };
  const openNew = () => { setErrors({}); setModal({ form: { name: '', domain: '', phone: '', owner_id: user?.id || '', custom: {} } }); };
  const openEdit = (c) => {
    setErrors({});
    setModal({ id: c.id, version: c.version, form: { name: c.name || '', domain: c.domain || '', phone: c.phone || '', owner_id: c.owner_id || '', custom: c.custom || {} } });
  };
  const setForm = (patch) => setModal((m) => ({ ...m, form: { ...m.form, ...patch } }));

  const save = async (e) => {
    e.preventDefault();
    const f = modal.form;
    setBusy(true); setErrors({});
    const body = { name: f.name.trim(), domain: f.domain.trim() || null, phone: f.phone.trim() || null, owner_id: f.owner_id || null, custom: f.custom };
    try {
      if (modal.id) await apiPatch(`/companies/${modal.id}`, { ...body, version: modal.version });
      else await apiPost('/companies', body);
      toast.success(modal.id ? 'Company updated' : 'Company created');
      setModal(null);
      mutate();
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
      if (err.status === 409 && err.body?.current) { setModal(null); mutate(); }
    } finally { setBusy(false); }
  };

  const columns = [
    { key: 'name', label: 'Company', render: (c) => <span className="font-medium text-slate-900">{c.name}</span> },
    { key: 'domain', label: 'Website', render: (c) => c.domain || '—' },
    { key: 'phone', label: 'Phone', render: (c) => c.phone || '—' },
    { key: 'contact_count', label: 'Contacts', render: (c) => c.contact_count ?? 0 },
    { key: 'owner_name', label: 'Owner', render: (c) => c.owner_name || 'Unassigned' },
    { key: 'created_at', label: 'Created', render: (c) => dateOnly(c.created_at) },
    {
      key: 'actions', label: <span className="sr-only">Actions</span>,
      render: (c) => (can('crm.edit') ? <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); openEdit(c); }}>Edit</Button></div> : null),
    },
  ];

  const empty = hasFilters
    ? <EmptyState title="No companies match these filters" body="Try removing a filter or clearing them all." />
    : <EmptyState title="No companies yet" body="Add a company, then link contacts to it." action={can('crm.create') && <Button onClick={openNew}>+ New company</Button>} />;

  const form = modal?.form;
  return (
    <div>
      <PageHeader title="Companies" subtitle="Organisations your contacts belong to."
        actions={can('crm.create') && <Button onClick={openNew}>+ New company</Button>} />

      <FilterBar entity="company" value={filters} onChange={applyFilters} />
      <DataTable columns={columns} rows={data?.data} loading={isLoading} error={error} empty={empty} />
      <Pagination page={page} limit={LIMIT} total={data?.total || 0} onChange={setPage} />

      <Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal?.id ? 'Edit company' : 'New company'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" form="company-form" loading={busy}>{modal?.id ? 'Save changes' : 'Create company'}</Button></>}>
        {form && (
          <form id="company-form" onSubmit={save} className="flex flex-col gap-3">
            <Field label="Company name" required error={errors.name}><Input value={form.name} onChange={(e) => setForm({ name: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Website / domain" error={errors.domain}><Input placeholder="example.com" value={form.domain} onChange={(e) => setForm({ domain: e.target.value })} /></Field>
              <Field label="Phone" error={errors.phone}><Input type="tel" value={form.phone} onChange={(e) => setForm({ phone: e.target.value })} /></Field>
            </div>
            <Field label="Owner" error={errors.owner_id}>
              <Select placeholder="Unassigned" value={form.owner_id} onChange={(e) => setForm({ owner_id: e.target.value })}
                options={(usersRes?.data || []).map((u) => ({ value: u.id, label: u.name }))} />
            </Field>
            <CustomFieldInputs fields={defs} value={form.custom} onChange={(custom) => setForm({ custom })} errors={errors} />
          </form>
        )}
      </Modal>
    </div>
  );
}
