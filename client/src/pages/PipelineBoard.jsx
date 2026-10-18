// Ahmed — Kanban-style pipeline board (F2.4, F2.5). One column per stage; only the board scrolls sideways.
// "Move to…" → POST /opportunities/:id/move. On 422 we show "Fill: X, Y" and open the edit modal, then retry the move.
import { useState } from 'react';
import useSWR from 'swr';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { apiGet, apiPost, qs } from '../utils/api';
import { money } from '../utils/format';
import { Badge, EmptyState, Field, PageHeader, Select, Spinner } from '../components/ui';
import OpportunityFormModal from '../components/OpportunityFormModal';

const LIMIT = 100;
const KIND_TONE = { open: 'blue', won: 'green', lost: 'red' };

export default function PipelineBoard() {
  const [pipelineId, setPipelineId] = useState('');
  const [movingId, setMovingId] = useState(null);
  const [fix, setFix] = useState(null); // { opp, stageId, missing }

  const { data: pipesRes, error: pipesError } = useSWR('/pipelines', apiGet);
  const pipelines = pipesRes?.data || [];
  const pipeline = pipelines.find((p) => p.id === pipelineId) || pipelines[0];
  const { data, error, isLoading, mutate } = useSWR(pipeline ? `/opportunities${qs({ pipeline_id: pipeline.id, limit: LIMIT })}` : null, apiGet, { refreshInterval: 10000, keepPreviousData: true });
  const opps = data?.data || [];

  const move = async (opp, stageId) => {
    if (!stageId || stageId === opp.stage_id) return;
    setMovingId(opp.id);
    try {
      await apiPost(`/opportunities/${opp.id}/move`, { stage_id: stageId, version: opp.version });
      toast.success(`Moved “${opp.title}”`);
    } catch (err) {
      if (err.status === 422) {
        const missing = err.body?.missing || [];
        toast.error(missing.length ? `Fill: ${missing.map((m) => m.label).join(', ')}` : err.message);
        setFix({ opp, stageId, missing });
      } else toast.error(err.message);
    } finally { setMovingId(null); mutate(); }
  };

  const retryAfterFix = (updated) => {
    const f = fix;
    setFix(null);
    if (f) move(updated, f.stageId);
  };

  if (pipesError) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Couldn&apos;t load pipelines: {pipesError.message}</div>;

  return (
    <div>
      <PageHeader title="Pipeline" subtitle="Move deals between stages." />
      <div className="mb-4 max-w-xs">
        <Field label="Pipeline">
          <Select value={pipeline?.id || ''} onChange={(e) => setPipelineId(e.target.value)} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
      </div>

      {!pipesRes && <div className="flex justify-center p-10"><Spinner label="Loading pipelines" /></div>}
      {pipesRes && !pipeline && <EmptyState title="No pipelines yet" body="Ask an admin to create one in Settings → Pipelines." />}
      {error && <div role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Couldn&apos;t load opportunities: {error.message}</div>}
      {pipeline && data?.total > LIMIT && <p className="mb-2 text-xs text-slate-500">Showing the {LIMIT} newest of {data.total} opportunities. Use the Opportunities list for the rest.</p>}

      {pipeline && (
        <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" tabIndex={0} aria-label={`${pipeline.name} board`}>
          <div className="flex min-w-min gap-3">
            {pipeline.stages.map((stage) => {
              const cards = opps.filter((o) => o.stage_id === stage.id);
              return (
                <section key={stage.id} aria-label={`${stage.name} stage`} className="w-72 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <header className="mb-2 flex items-center justify-between gap-2 px-1">
                    <h2 className="truncate text-sm font-semibold text-slate-800">{stage.name}</h2>
                    <span className="flex items-center gap-1"><Badge tone={KIND_TONE[stage.kind]}>{stage.kind}</Badge><Badge>{cards.length}</Badge></span>
                  </header>
                  <ul className="flex flex-col gap-2">
                    {cards.map((o) => (
                      <li key={o.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                        <Link to={`/opportunities/${o.id}`} className="font-medium text-slate-900 hover:text-primary hover:underline">{o.title}</Link>
                        <p className="text-xs text-slate-500">{o.contact_name}</p>
                        <p className="mt-1 text-sm text-slate-700">{o.value_masked ? <Badge>Hidden</Badge> : money(o.value_cents, o.currency)}</p>
                        <p className="text-xs text-slate-500">{o.owner_name || 'Unassigned'}</p>
                        <Field label="Move to…" className="mt-2">
                          <Select placeholder="Choose stage…" value="" disabled={movingId === o.id} onChange={(e) => move(o, e.target.value)}
                            options={pipeline.stages.filter((s) => s.id !== o.stage_id).map((s) => ({ value: s.id, label: s.name }))} />
                        </Field>
                      </li>
                    ))}
                    {!cards.length && !isLoading && <li className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">No opportunities</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <OpportunityFormModal open={Boolean(fix)} onClose={() => setFix(null)} opportunity={fix?.opp || null} pipelines={pipelines} missing={fix?.missing || []} onSaved={retryAfterFix} />
    </div>
  );
}
