// Ahmed — filter bar for CRM lists (F2.6). <FilterBar entity="contact" value={filters} onChange={(f)=>…} />
// `value` is a plain object of list-endpoint query params (q, tag, owner_id, stage_id, from, to, field.<key>).
// "Save as list" stores those params; "My lists" re-applies them.
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPost } from '../utils/api';
import { Button, Field, Input, Modal, Select } from './ui';

const FILTER_KEY = /^(q|tag|owner_id|company_id|pipeline_id|stage_id|stage_kind|contact_id|from|to|field\..+)$/;
const clean = (obj) => Object.fromEntries(
  Object.entries(obj || {}).filter(([k, v]) => FILTER_KEY.test(k) && v !== '' && v !== null && v !== undefined),
);

export default function FilterBar({ entity = 'contact', value = {}, onChange }) {
  const { data: usersRes } = useSWR('/users', apiGet);
  const { data: fieldsRes } = useSWR(`/custom-fields?entity=${entity}`, apiGet);
  const { data: pipesRes } = useSWR(entity === 'opportunity' ? '/pipelines' : null, apiGet);
  const { data: listsRes, mutate: mutateLists } = useSWR(`/saved-lists?entity=${entity}`, apiGet);

  const valueRef = useRef(value);
  valueRef.current = value;
  const update = (patch) => { setListId(''); onChange(clean({ ...valueRef.current, ...patch })); };

  // search box is debounced so we don't query on every keystroke
  const [qDraft, setQDraft] = useState(value.q || '');
  useEffect(() => { setQDraft(value.q || ''); }, [value.q]);
  useEffect(() => {
    if (qDraft === (valueRef.current.q || '')) return undefined;
    const t = setTimeout(() => update({ q: qDraft }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);

  const activeFieldKey = Object.keys(value).find((k) => k.startsWith('field.'))?.slice(6) || '';
  const [cfKey, setCfKey] = useState(activeFieldKey);
  useEffect(() => { setCfKey(activeFieldKey); }, [activeFieldKey]);

  const [listId, setListId] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [listName, setListName] = useState('');
  const [saving, setSaving] = useState(false);

  const users = usersRes?.data || [];
  const defs = fieldsRes?.data || [];
  const lists = listsRes?.data || [];
  const stageOptions = (pipesRes?.data || []).flatMap((p) => (p.stages || []).map((s) => ({ value: s.id, label: `${p.name} · ${s.name}` })));
  const def = defs.find((d) => d.key === cfKey);
  const active = clean(value);
  const hasFilters = Object.keys(active).length > 0;

  const pickField = (key) => {
    const old = activeFieldKey ? { [`field.${activeFieldKey}`]: '' } : {};
    setCfKey(key);
    if (activeFieldKey) update(old);
  };

  const applyList = (id) => {
    setListId(id);
    const l = lists.find((x) => x.id === id);
    if (l) onChange(clean(l.filters));
  };

  const saveList = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiPost('/saved-lists', { entity, name: listName.trim(), filters: active });
      toast.success(`Saved list “${res.data.name}”`);
      setSaveOpen(false); setListName('');
      await mutateLists();
      setListId(res.data.id);
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const fieldValueInput = () => {
    const k = `field.${cfKey}`;
    const v = value[k] ?? '';
    if (def.type === 'dropdown') return <Select placeholder="Any" value={v} onChange={(e) => update({ [k]: e.target.value })} options={(def.options || []).map((o) => ({ value: o, label: o }))} />;
    if (def.type === 'checkbox') return <Select placeholder="Any" value={v} onChange={(e) => update({ [k]: e.target.value })} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />;
    return <Input type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'} value={v} onChange={(e) => update({ [k]: e.target.value })} />;
  };

  return (
    <section aria-label="Filters" className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search"><Input type="search" placeholder="Name, email, phone…" value={qDraft} onChange={(e) => setQDraft(e.target.value)} /></Field>
        {entity === 'contact' && (
          <Field label="Tag"><Input placeholder="e.g. solar" value={value.tag || ''} onChange={(e) => update({ tag: e.target.value.trim() })} /></Field>
        )}
        {entity === 'opportunity' && (
          <Field label="Stage"><Select placeholder="Any stage" value={value.stage_id || ''} onChange={(e) => update({ stage_id: e.target.value })} options={stageOptions} /></Field>
        )}
        <Field label="Owner">
          <Select placeholder="Anyone" value={value.owner_id || ''} onChange={(e) => update({ owner_id: e.target.value })}
            options={[{ value: 'none', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        </Field>
        <Field label="Created from"><Input type="date" value={value.from || ''} onChange={(e) => update({ from: e.target.value })} /></Field>
        <Field label="Created to"><Input type="date" value={value.to || ''} onChange={(e) => update({ to: e.target.value })} /></Field>
        {defs.length > 0 && (
          <Field label="Custom field">
            <Select placeholder="None" value={cfKey} onChange={(e) => pickField(e.target.value)} options={defs.map((d) => ({ value: d.key, label: d.label }))} />
          </Field>
        )}
        {def && <Field label={`${def.label} is`}>{fieldValueInput()}</Field>}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Button size="sm" variant="secondary" disabled={!hasFilters} onClick={() => setSaveOpen(true)}>Save as list</Button>
        <Button size="sm" variant="ghost" disabled={!hasFilters} onClick={() => { setListId(''); setCfKey(''); onChange({}); }}>Clear filters</Button>
        {lists.length > 0 && (
          <Field label="My lists" className="ml-auto min-w-[12rem]">
            <Select placeholder="Choose a saved list…" value={listId} onChange={(e) => applyList(e.target.value)} options={lists.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
        )}
      </div>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save as list" size="sm"
        footer={<><Button variant="secondary" onClick={() => setSaveOpen(false)}>Cancel</Button><Button type="submit" form="save-list-form" loading={saving} disabled={!listName.trim()}>Save list</Button></>}>
        <form id="save-list-form" onSubmit={saveList} className="flex flex-col gap-3">
          <Field label="List name" required hint="Opening the list re-runs these filters, so it always shows current records.">
            <Input value={listName} maxLength={80} onChange={(e) => setListName(e.target.value)} />
          </Field>
        </form>
      </Modal>
    </section>
  );
}
