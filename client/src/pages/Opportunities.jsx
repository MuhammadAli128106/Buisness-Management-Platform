// Ahmed — Opportunities list (F2.1, F2.3, F1.4). The pipeline selector changes which custom fields show.
// Value shows "Hidden" when the server masks it (value_masked). Dashboard drill-down opens with ?stage_id=.
import { useState } from 'react';
import useSWR from 'swr';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, qs } from '../utils/api';
import { useCan } from '../hooks/useCan';
import { dateOnly, money } from '../utils/format';
import { Badge, Button, DataTable, EmptyState, Field, PageHeader, Pagination, Select } from '../components/ui';
import FilterBar from '../components/FilterBar';
import OpportunityFormModal from '../components/OpportunityFormModal';

const LIMIT = 25;
const KIND_TONE = { open: 'blue', won: 'green', lost: 'red' };
const KIND_LABEL = { open: 'Open', won: 'Won', lost: 'Lost' };

export default function Opportunities() {
  const navigate = useNavigate();
  const can = useCan();
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => (searchParams.get('stage_id') ? { stage_id: searchParams.get('stage_id') } : {}));
  const [pipelineId, setPipelineId] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: pipesRes } = useSWR('/pipelines', apiGet);
  const pipelines = pipesRes?.data || [];
  const { data, error, isLoading, mutate } = useSWR(`/opportunities${qs({ ...filters, pipeline_id: pipelineId, page, limit: LIMIT })}`, apiGet, { keepPreviousData: true });
  const { data: defsRes } = useSWR(pipelineId ? `/custom-fields?entity=opportunity&pipeline_id=${pipelineId}` : null, apiGet);
  const extraCols = (pipelineId ? defsRes?.data || [] : []).slice(0, 3);
  const hasFilters = Object.keys(filters).length > 0 || pipelineId;

  const applyFilters = (f) => { setFilters(f); setPage(1); };

  const showCustom = (def, o) => {
    const v = o.custom?.[def.key];
    if (v === undefined || v === null || v === '') return '—';
    if (def.type === 'checkbox') return v === true || v === 'true' ? 'Yes' : 'No';
    if (def.type === 'date') return dateOnly(v);
    return String(v);
  };

  const columns = [
    { key: 'title', label: 'Opportunity', render: (o) => <div><p className="font-medium text-slate-900">{o.title}</p><p className="text-xs text-slate-500">{o.contact_name}</p></div> },
    { key: 'stage_name', label: 'Stage', render: (o) => <span className="flex flex-wrap items-center gap-1"><span>{o.stage_name}</span><Badge tone={KIND_TONE[o.stage_kind]}>{KIND_LABEL[o.stage_kind] || o.stage_kind}</Badge></span> },
    { key: 'value', label: 'Value', render: (o) => (o.value_masked ? <Badge>Hidden</Badge> : money(o.value_cents, o.currency)) },
    { key: 'pipeline_name', label: 'Pipeline' },
    { key: 'owner_name', label: 'Owner', render: (o) => o.owner_name || 'Unassigned' },
    ...extraCols.map((d) => ({ key: `cf_${d.key}`, label: d.label, render: (o) => showCustom(d, o) })),
    { key: 'created_at', label: 'Created', render: (o) => dateOnly(o.created_at) },
  ];

  const empty = hasFilters
    ? <EmptyState title="No opportunities match these filters" body="Try removing a filter or choosing another pipeline." />
    : <EmptyState title="No opportunities yet" body="Create one from here or from a contact." action={can('crm.create') && <Button onClick={() => setCreateOpen(true)}>+ New opportunity</Button>} />;

  return (
    <div>
      <PageHeader title="Opportunities" subtitle="Deals moving through your pipelines."
        actions={can('crm.create') && <Button onClick={() => setCreateOpen(true)}>+ New opportunity</Button>} />

      <div className="mb-3 max-w-xs">
        <Field label="Pipeline" hint="Pick a pipeline to see its custom fields as columns">
          <Select placeholder="All pipelines" value={pipelineId} onChange={(e) => { setPipelineId(e.target.value); setPage(1); }} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
      </div>

      <FilterBar entity="opportunity" value={filters} onChange={applyFilters} />
      <DataTable columns={columns} rows={data?.data} loading={isLoading} error={error} empty={empty} onRowClick={(o) => navigate(`/opportunities/${o.id}`)} />
      <Pagination page={page} limit={LIMIT} total={data?.total || 0} onChange={setPage} />

      <OpportunityFormModal open={createOpen} onClose={() => setCreateOpen(false)} pipelines={pipelines} defaultPipelineId={pipelineId} onSaved={() => mutate()} />
    </div>
  );
}
