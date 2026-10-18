// Ahmed — Settings → Custom fields (F2.2, F2.3). Add / edit / delete. For opportunities a field can belong to one pipeline or all.
// The server only lets you change label and dropdown options after creation (type and key are fixed).
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../utils/api';
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '../../components/ui';

const ENTITIES = [{ value: 'contact', label: 'Contacts' }, { value: 'company', label: 'Companies' }, { value: 'opportunity', label: 'Opportunities' }];
const TYPES = [{ value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' }, { value: 'dropdown', label: 'Dropdown' }, { value: 'checkbox', label: 'Checkbox (yes / no)' }];
const entityLabel = (e) => ENTITIES.find((x) => x.value === e)?.label || e;
const parseOptions = (text) => [...new Set(text.split('\n').map((s) => s.trim()).filter(Boolean))];

export default function CustomFields() {
  const { data, error, isLoading, mutate } = useSWR('/custom-fields', apiGet);
  const { data: pipesRes } = useSWR('/pipelines', apiGet);
  const pipelines = pipesRes?.data || [];
  const pipeName = (id) => pipelines.find((p) => p.id === id)?.name || 'Unknown pipeline';

  const [entity, setEntity] = useState('');
  const [modal, setModal] = useState(null); // { id?, entity, pipeline_id, label, type, optionsText }
  const [del, setDel] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const rows = (data?.data || []).filter((f) => !entity || f.entity === entity);

  const openNew = () => { setErrors({}); setModal({ entity: entity || 'contact', pipeline_id: '', label: '', type: 'text', optionsText: '' }); };
  const openEdit = (f) => { setErrors({}); setModal({ id: f.id, entity: f.entity, pipeline_id: f.pipeline_id || '', label: f.label, type: f.type, optionsText: (f.options || []).join('\n') }); };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      const options = parseOptions(modal.optionsText);
      if (modal.id) await apiPatch(`/custom-fields/${modal.id}`, { label: modal.label.trim(), ...(modal.type === 'dropdown' ? { options } : {}) });
      else await apiPost('/custom-fields', { entity: modal.entity, pipeline_id: modal.entity === 'opportunity' && modal.pipeline_id ? modal.pipeline_id : null, label: modal.label.trim(), type: modal.type, options: modal.type === 'dropdown' ? options : [] });
      toast.success(modal.id ? 'Field updated' : 'Field added');
      setModal(null); mutate();
    } catch (err) { setErrors(err.details || {}); toast.error(err.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await apiDelete(`/custom-fields/${del.id}`); toast.success('Field deleted'); setDel(null); mutate(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const columns = [
    { key: 'label', label: 'Field', render: (f) => <div><p className="font-medium text-slate-900">{f.label}</p><p className="font-mono text-xs text-slate-500">{f.key}</p></div> },
    { key: 'type', label: 'Type', render: (f) => <Badge>{TYPES.find((t) => t.value === f.type)?.label || f.type}</Badge> },
    { key: 'entity', label: 'Applies to', render: (f) => (f.entity === 'opportunity' ? `Opportunities · ${f.pipeline_id ? pipeName(f.pipeline_id) : 'All pipelines'}` : entityLabel(f.entity)) },
    { key: 'options', label: 'Options', render: (f) => (f.type === 'dropdown' ? (f.options || []).join(', ') || '—' : '—') },
    {
      key: 'actions', label: <span className="sr-only">Actions</span>,
      render: (f) => <div className="flex justify-end gap-1"><Button size="sm" variant="secondary" onClick={() => openEdit(f)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setDel(f)}>Delete</Button></div>,
    },
  ];

  return (
    <div>
      <PageHeader title="Custom fields" subtitle="Extra information to capture on contacts, companies and opportunities." actions={<Button onClick={openNew}>+ Add field</Button>} />
      <div className="mb-3 max-w-xs">
        <Field label="Show fields for"><Select placeholder="Everything" value={entity} onChange={(e) => setEntity(e.target.value)} options={ENTITIES} /></Field>
      </div>
      <DataTable columns={columns} rows={rows} loading={isLoading} error={error}
        empty={<EmptyState title="No custom fields yet" body="Add a field like “Roof size” and it appears on the matching forms." action={<Button onClick={openNew}>+ Add field</Button>} />} />

      <Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal?.id ? 'Edit field' : 'Add field'}
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" form="field-form" loading={busy}>{modal?.id ? 'Save' : 'Add field'}</Button></>}>
        {modal && (
          <form id="field-form" onSubmit={save} className="flex flex-col gap-3">
            <Field label="Applies to" error={errors.entity} hint={modal.id ? 'Cannot be changed after creation' : undefined}>
              <Select disabled={Boolean(modal.id)} value={modal.entity} onChange={(e) => setModal({ ...modal, entity: e.target.value, pipeline_id: '' })} options={ENTITIES} />
            </Field>
            {modal.entity === 'opportunity' && (
              <Field label="Pipeline" error={errors.pipeline_id} hint={modal.id ? 'Cannot be changed after creation' : 'Leave as “All pipelines”, or pick one so only its opportunities show this field'}>
                <Select disabled={Boolean(modal.id)} placeholder="All pipelines" value={modal.pipeline_id} onChange={(e) => setModal({ ...modal, pipeline_id: e.target.value })} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} />
              </Field>
            )}
            <Field label="Label" required error={errors.label}><Input value={modal.label} maxLength={60} onChange={(e) => setModal({ ...modal, label: e.target.value })} /></Field>
            <Field label="Type" error={errors.type} hint={modal.id ? 'Cannot be changed after creation' : undefined}>
              <Select disabled={Boolean(modal.id)} value={modal.type} onChange={(e) => setModal({ ...modal, type: e.target.value })} options={TYPES} />
            </Field>
            {modal.type === 'dropdown' && (
              <Field label="Options" required error={errors.options} hint="One option per line">
                <Textarea rows={5} value={modal.optionsText} onChange={(e) => setModal({ ...modal, optionsText: e.target.value })} />
              </Field>
            )}
          </form>
        )}
      </Modal>

      <ConfirmDialog open={Boolean(del)} title="Delete field?" confirmLabel="Delete field" loading={busy} onCancel={() => setDel(null)} onConfirm={remove}
        message={`“${del?.label}” will stop showing on forms and filters${del?.entity === 'opportunity' ? ', and will be removed from any stage requirements' : ''}.`} />
    </div>
  );
}
