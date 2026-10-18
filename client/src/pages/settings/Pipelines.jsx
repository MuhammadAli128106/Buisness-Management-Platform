// Ahmed — Settings → Pipelines (F2.5, F2.4). Pipelines + stages: add, rename, kind, required fields, up/down reorder,
// safe delete ("move existing opportunities to…").
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../utils/api';
import { Badge, Button, Checkbox, ConfirmDialog, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select } from '../../components/ui';

const KINDS = [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won (closed)' }, { value: 'lost', label: 'Lost (closed)' }];
const KIND_TONE = { open: 'blue', won: 'green', lost: 'red' };

export default function Pipelines() {
  const { data, error, isLoading, mutate } = useSWR('/pipelines', apiGet);
  const { data: defsRes } = useSWR('/custom-fields?entity=opportunity', apiGet);
  const pipelines = data?.data || [];
  const [selectedId, setSelectedId] = useState('');
  const pipeline = pipelines.find((p) => p.id === selectedId) || pipelines[0];
  const stages = pipeline?.stages || [];

  const fieldChoices = [
    { key: 'value_cents', label: 'Deal value' },
    ...(defsRes?.data || []).filter((d) => !d.pipeline_id || d.pipeline_id === pipeline?.id).map((d) => ({ key: d.key, label: d.label })),
  ];
  const labelOf = (key) => fieldChoices.find((f) => f.key === key)?.label || key;

  const [busy, setBusy] = useState(false);
  const [pipeModal, setPipeModal] = useState(null); // { id?, name }
  const [stageModal, setStageModal] = useState(null); // { id?, name, kind, required_field_keys }
  const [delStage, setDelStage] = useState(null); // { stage, moveTo, forceMove }
  const [delPipe, setDelPipe] = useState(false);
  const [errors, setErrors] = useState({});

  const run = async (fn, okMsg) => {
    setBusy(true); setErrors({});
    try { const r = await fn(); if (okMsg) toast.success(okMsg); await mutate(); return r ?? true; } catch (err) { setErrors(err.details || {}); toast.error(err.message); return false; } finally { setBusy(false); }
  };

  const savePipeline = async (e) => {
    e.preventDefault();
    const name = pipeModal.name.trim();
    const ok = await run(async () => (pipeModal.id ? apiPatch(`/pipelines/${pipeModal.id}`, { name }) : apiPost('/pipelines', { name })), pipeModal.id ? 'Pipeline renamed' : 'Pipeline created');
    if (ok) { if (!pipeModal.id && ok.data) setSelectedId(ok.data.id); setPipeModal(null); }
  };
  const removePipeline = async () => { if (await run(() => apiDelete(`/pipelines/${pipeline.id}`), 'Pipeline deleted')) { setDelPipe(false); setSelectedId(''); } };

  const saveStage = async (e) => {
    e.preventDefault();
    const body = { name: stageModal.name.trim(), kind: stageModal.kind, required_field_keys: stageModal.required_field_keys };
    const ok = await run(() => (stageModal.id ? apiPatch(`/stages/${stageModal.id}`, body) : apiPost(`/pipelines/${pipeline.id}/stages`, body)), stageModal.id ? 'Stage updated' : 'Stage added');
    if (ok) setStageModal(null);
  };

  const reorder = (index, dir) => {
    const ids = stages.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    run(() => apiPut(`/pipelines/${pipeline.id}/stages/order`, { ids }));
  };

  const removeStage = async () => {
    const { stage, moveTo } = delStage;
    setBusy(true);
    try {
      await apiDelete(`/stages/${stage.id}${moveTo ? `?move_to=${moveTo}` : ''}`);
      toast.success(moveTo ? 'Stage deleted and opportunities moved' : 'Stage deleted');
      setDelStage(null); mutate();
    } catch (err) {
      toast.error(err.message);
      if (err.status === 409 && /Choose a stage/i.test(err.message)) setDelStage((d) => ({ ...d, forceMove: true }));
    } finally { setBusy(false); }
  };

  const toggleKey = (key) => setStageModal((m) => ({ ...m, required_field_keys: m.required_field_keys.includes(key) ? m.required_field_keys.filter((k) => k !== key) : [...m.required_field_keys, key] }));

  const columns = [
    { key: 'name', label: 'Stage', render: (s) => <span className="font-medium text-slate-900">{s.name}</span> },
    { key: 'kind', label: 'Type', render: (s) => <Badge tone={KIND_TONE[s.kind]}>{s.kind}</Badge> },
    { key: 'required', label: 'Required before entering', render: (s) => (s.required_field_keys?.length ? s.required_field_keys.map(labelOf).join(', ') : '—') },
    { key: 'opportunity_count', label: 'Opportunities', render: (s) => s.opportunity_count ?? 0 },
    {
      key: 'order', label: 'Order',
      render: (s) => {
        const i = stages.findIndex((x) => x.id === s.id);
        return (
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" disabled={busy || i === 0} aria-label={`Move ${s.name} up`} onClick={() => reorder(i, -1)}>↑</Button>
            <Button size="sm" variant="secondary" disabled={busy || i === stages.length - 1} aria-label={`Move ${s.name} down`} onClick={() => reorder(i, 1)}>↓</Button>
          </div>
        );
      },
    },
    {
      key: 'actions', label: <span className="sr-only">Actions</span>,
      render: (s) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="secondary" onClick={() => { setErrors({}); setStageModal({ id: s.id, name: s.name, kind: s.kind, required_field_keys: s.required_field_keys || [] }); }}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => setDelStage({ stage: s, moveTo: '', forceMove: false })}>Delete</Button>
        </div>
      ),
    },
  ];

  const moveOptions = delStage ? stages.filter((s) => s.id !== delStage.stage.id).map((s) => ({ value: s.id, label: s.name })) : [];
  const needMove = delStage && (delStage.stage.opportunity_count > 0 || delStage.forceMove);

  return (
    <div>
      <PageHeader title="Pipelines" subtitle="Stages your opportunities move through, and what must be filled in before each one."
        actions={<Button onClick={() => { setErrors({}); setPipeModal({ name: '' }); }}>+ New pipeline</Button>} />

      {error && <div role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Couldn&apos;t load pipelines: {error.message}</div>}
      {pipeline ? (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Field label="Pipeline" className="min-w-[14rem]"><Select value={pipeline.id} onChange={(e) => setSelectedId(e.target.value)} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} /></Field>
            <Button variant="secondary" onClick={() => { setErrors({}); setPipeModal({ id: pipeline.id, name: pipeline.name }); }}>Rename</Button>
            <Button variant="ghost" onClick={() => setDelPipe(true)}>Delete pipeline</Button>
            <Button className="sm:ml-auto" onClick={() => { setErrors({}); setStageModal({ name: '', kind: 'open', required_field_keys: [] }); }}>+ Add stage</Button>
          </div>
          <DataTable columns={columns} rows={stages} loading={isLoading} empty="This pipeline has no stages" />
        </>
      ) : !isLoading && !error && <EmptyState title="No pipelines yet" body="Create your first pipeline to start tracking deals." />}

      <Modal open={Boolean(pipeModal)} onClose={() => setPipeModal(null)} title={pipeModal?.id ? 'Rename pipeline' : 'New pipeline'} size="sm"
        footer={<><Button variant="secondary" onClick={() => setPipeModal(null)}>Cancel</Button><Button type="submit" form="pipe-form" loading={busy}>Save</Button></>}>
        {pipeModal && (
          <form id="pipe-form" onSubmit={savePipeline} className="flex flex-col gap-3">
            <Field label="Pipeline name" required error={errors.name} hint={pipeModal.id ? undefined : 'Starts with New, In progress, Won and Lost — change them afterwards'}>
              <Input value={pipeModal.name} maxLength={80} onChange={(e) => setPipeModal({ ...pipeModal, name: e.target.value })} />
            </Field>
          </form>
        )}
      </Modal>

      <Modal open={Boolean(stageModal)} onClose={() => setStageModal(null)} title={stageModal?.id ? 'Edit stage' : 'Add stage'}
        footer={<><Button variant="secondary" onClick={() => setStageModal(null)}>Cancel</Button><Button type="submit" form="stage-form" loading={busy}>Save stage</Button></>}>
        {stageModal && (
          <form id="stage-form" onSubmit={saveStage} className="flex flex-col gap-3">
            <Field label="Stage name" required error={errors.name}><Input value={stageModal.name} maxLength={60} onChange={(e) => setStageModal({ ...stageModal, name: e.target.value })} /></Field>
            <Field label="Type" hint="Won and Lost stages close the opportunity"><Select value={stageModal.kind} onChange={(e) => setStageModal({ ...stageModal, kind: e.target.value })} options={KINDS} /></Field>
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">Required before an opportunity can enter this stage</legend>
              <div className="mt-2 flex flex-col gap-2">
                {fieldChoices.map((f) => <Checkbox key={f.key} label={f.label} checked={stageModal.required_field_keys.includes(f.key)} onChange={() => toggleKey(f.key)} />)}
              </div>
              {errors.required_field_keys && <p className="mt-1 text-xs font-medium text-red-700">⚠ {errors.required_field_keys}</p>}
            </fieldset>
          </form>
        )}
      </Modal>

      <ConfirmDialog open={delPipe} title="Delete pipeline?" confirmLabel="Delete pipeline" loading={busy} onCancel={() => setDelPipe(false)} onConfirm={removePipeline}
        message={`“${pipeline?.name}” and its stages and pipeline-specific custom fields will be deleted. A pipeline that still has opportunities can't be deleted.`} />

      <ConfirmDialog open={Boolean(delStage)} title={`Delete stage “${delStage?.stage.name}”?`} confirmLabel="Delete stage" loading={busy}
        onCancel={() => setDelStage(null)} onConfirm={removeStage}>
        {delStage && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">{needMove ? `This stage has opportunities. Choose where to move them.` : 'This stage is empty, so nothing else will change.'}</p>
            {needMove && (
              <Field label="Move existing opportunities to…" required>
                <Select placeholder="Choose a stage…" value={delStage.moveTo} onChange={(e) => setDelStage({ ...delStage, moveTo: e.target.value })} options={moveOptions} />
              </Field>
            )}
            {needMove && !delStage.moveTo && <p className="text-xs text-amber-700">Pick a stage before deleting.</p>}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
