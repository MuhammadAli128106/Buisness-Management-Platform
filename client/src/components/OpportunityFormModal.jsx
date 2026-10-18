// Ahmed — shared create/edit modal for opportunities (used by Opportunities, PipelineBoard, OpportunityDetail, ContactDetail).
// <OpportunityFormModal open onClose opportunity={null|opp} pipelines={[]} defaultPipelineId defaultContactId missing={[{key,label}]} onSaved={(opp)=>…} />
// Create when `opportunity` is null. `missing` shows the "fill these first" notice after a blocked stage move (F2.4).
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useCan } from '../hooks/useCan';
import { Button, Field, Input, Modal, Select } from './ui';
import CustomFieldInputs from './CustomFieldInputs';

const initial = (o, { defaultPipelineId, defaultContactId, userId }) => (o ? {
  title: o.title || '', contact_id: o.contact_id || '', pipeline_id: o.pipeline_id || '',
  amount: o.value_cents === null || o.value_cents === undefined ? '' : String(o.value_cents / 100),
  currency: o.currency || 'USD', owner_id: o.owner_id || '', custom: o.custom || {},
} : {
  title: '', contact_id: defaultContactId || '', pipeline_id: defaultPipelineId || '',
  amount: '', currency: 'USD', owner_id: userId || '', custom: {},
});

export default function OpportunityFormModal({ open, onClose, opportunity = null, pipelines = [], defaultPipelineId = '', defaultContactId = '', missing = [], onSaved }) {
  const { user } = useAuth();
  const can = useCan();
  const canValue = can('opp.value.view');
  const [form, setForm] = useState(() => initial(opportunity, { defaultPipelineId, defaultContactId, userId: user?.id }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setForm(initial(opportunity, { defaultPipelineId: defaultPipelineId || pipelines[0]?.id, defaultContactId, userId: user?.id })); setErrors({}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opportunity?.id, opportunity?.version]);

  const { data: contactsRes } = useSWR(open ? '/contacts?limit=100' : null, apiGet);
  const { data: usersRes } = useSWR(open ? '/users' : null, apiGet);
  const { data: defsRes } = useSWR(open && form.pipeline_id ? `/custom-fields?entity=opportunity&pipeline_id=${form.pipeline_id}` : null, apiGet);
  const defs = defsRes?.data || [];
  const patch = (p) => setForm((f) => ({ ...f, ...p }));

  const contactOptions = (contactsRes?.data || []).map((c) => ({ value: c.id, label: c.name }));
  if (opportunity?.contact_id && !contactOptions.some((o) => o.value === opportunity.contact_id)) {
    contactOptions.unshift({ value: opportunity.contact_id, label: opportunity.contact_name || 'Current contact' });
  }

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErrors({});
    const body = { title: form.title.trim(), contact_id: form.contact_id, owner_id: form.owner_id || null, custom: form.custom };
    if (canValue) { body.value_cents = Math.round(Number(form.amount || 0) * 100); body.currency = form.currency.trim().toUpperCase(); }
    try {
      let res;
      if (opportunity) res = await apiPatch(`/opportunities/${opportunity.id}`, { ...body, version: opportunity.version });
      else res = await apiPost('/opportunities', { ...body, pipeline_id: form.pipeline_id });
      toast.success(opportunity ? 'Opportunity updated' : 'Opportunity created');
      onSaved?.(res.data);
      onClose();
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={opportunity ? 'Edit opportunity' : 'New opportunity'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="opp-form" loading={busy}>{opportunity ? 'Save changes' : 'Create opportunity'}</Button></>}>
      <form id="opp-form" onSubmit={save} className="flex flex-col gap-3">
        {missing.length > 0 && (
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Fill: <strong>{missing.map((m) => m.label).join(', ')}</strong> — then the move will continue automatically.
          </p>
        )}
        <Field label="Title" required error={errors.title}><Input value={form.title} onChange={(e) => patch({ title: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact" required error={errors.contact_id}>
            <Select placeholder="Choose a contact…" value={form.contact_id} onChange={(e) => patch({ contact_id: e.target.value })} options={contactOptions} />
          </Field>
          <Field label="Pipeline" required error={errors.pipeline_id} hint={opportunity ? 'Pipeline cannot be changed after creation' : undefined}>
            <Select placeholder="Choose a pipeline…" disabled={Boolean(opportunity)} value={form.pipeline_id}
              onChange={(e) => patch({ pipeline_id: e.target.value, custom: {} })} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {canValue && (
            <>
              <Field label="Value" error={errors.value_cents}><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => patch({ amount: e.target.value })} /></Field>
              <Field label="Currency" error={errors.currency} hint="3-letter code"><Input maxLength={3} value={form.currency} onChange={(e) => patch({ currency: e.target.value.toUpperCase() })} /></Field>
            </>
          )}
          <Field label="Owner" error={errors.owner_id}>
            <Select placeholder="Unassigned" value={form.owner_id} onChange={(e) => patch({ owner_id: e.target.value })} options={(usersRes?.data || []).map((u) => ({ value: u.id, label: u.name }))} />
          </Field>
        </div>
        <CustomFieldInputs fields={defs} value={form.custom} onChange={(custom) => patch({ custom })} errors={errors} />
      </form>
    </Modal>
  );
}
