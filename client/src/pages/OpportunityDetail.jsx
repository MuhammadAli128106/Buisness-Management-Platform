// Ahmed — opportunity detail (I2.1, I3.3). Details, stage move (422 → fill-in modal, then retry), payments panel,
// Book appointment, activity timeline. Value shows "Hidden" when masked (F1.4).
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiGet, apiPost, qs } from '../utils/api';
import { useCan } from '../hooks/useCan';
import { dateOnly, dateTime, money } from '../utils/format';
import { Badge, Button, EmptyState, Field, PageHeader, Select, Spinner } from '../components/ui';
import ActivityTimeline from '../components/ActivityTimeline';
import AppointmentsPanel from '../components/AppointmentsPanel';
import BookAppointmentModal from '../components/BookAppointmentModal';
import OpportunityFormModal from '../components/OpportunityFormModal';
import PaymentsPanel from '../components/PaymentsPanel';

const KIND_TONE = { open: 'blue', won: 'green', lost: 'red' };
const customText = (def, v) => {
  if (v === undefined || v === null || v === '') return '—';
  if (def.type === 'checkbox') return v === true || v === 'true' ? 'Yes' : 'No';
  if (def.type === 'date') return dateOnly(v);
  return String(v);
};

export default function OpportunityDetail() {
  const { id } = useParams();
  const can = useCan();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, error, isLoading, mutate } = useSWR(`/opportunities/${id}`, apiGet);
  const { data: pipesRes } = useSWR('/pipelines', apiGet);
  const opp = data?.data;
  const { data: defsRes } = useSWR(opp ? `/custom-fields?entity=opportunity&pipeline_id=${opp.pipeline_id}` : null, apiGet);

  const [editOpen, setEditOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [fix, setFix] = useState(null); // { stageId, missing }
  const [moving, setMoving] = useState(false);

  const refresh = () => { mutate(); globalMutate(`/activities${qs({ opportunity_id: id })}`); };

  if (error) return <EmptyState icon="🔍" title="Couldn't open this opportunity" body={error.message} action={<Link to="/opportunities" className="text-primary hover:underline">← Back to opportunities</Link>} />;
  if (!opp) return <div className="flex justify-center p-10"><Spinner label="Loading opportunity" /></div>;

  const pipelines = pipesRes?.data || [];
  const stages = pipelines.find((p) => p.id === opp.pipeline_id)?.stages || [];
  const defs = defsRes?.data || [];

  const move = async (current, stageId) => {
    if (!stageId || stageId === current.stage_id) return;
    setMoving(true);
    try {
      await apiPost(`/opportunities/${current.id}/move`, { stage_id: stageId, version: current.version });
      toast.success('Stage updated');
    } catch (err) {
      if (err.status === 422) {
        const missing = err.body?.missing || [];
        toast.error(missing.length ? `Fill: ${missing.map((m) => m.label).join(', ')}` : err.message);
        setFix({ stageId, missing });
      } else toast.error(err.message);
    } finally { setMoving(false); refresh(); }
  };

  const retryAfterFix = (updated) => {
    const f = fix;
    setFix(null);
    if (f) move(updated, f.stageId);
  };

  const detail = (label, value) => (<div><dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt><dd className="break-words text-sm text-slate-900">{value || '—'}</dd></div>);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={opp.title} subtitle={`${opp.pipeline_name} · ${opp.stage_name}`}
        actions={(
          <>
            <Link to="/opportunities" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">← Opportunities</Link>
            {can('crm.edit') && <Button variant="secondary" onClick={() => setBookOpen(true)}>Book appointment</Button>}
            {can('crm.edit') && <Button onClick={() => setEditOpen(true)}>Edit</Button>}
          </>
        )} />

      <section aria-labelledby="od-h" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="od-h" className="mb-3 font-semibold text-slate-900">Details</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {detail('Contact', <Link className="text-primary hover:underline" to={`/contacts/${opp.contact_id}`}>{opp.contact_name}</Link>)}
          {detail('Pipeline', opp.pipeline_name)}
          {detail('Stage', <span className="flex items-center gap-1">{opp.stage_name}<Badge tone={KIND_TONE[opp.stage_kind]}>{opp.stage_kind}</Badge></span>)}
          {detail('Value', opp.value_masked ? <Badge>Hidden</Badge> : money(opp.value_cents, opp.currency))}
          {detail('Owner', opp.owner_name || 'Unassigned')}
          {detail('Created', dateTime(opp.created_at))}
          {opp.closed_at && detail('Closed', dateTime(opp.closed_at))}
          {defs.map((def) => <div key={def.id}>{detail(def.label, customText(def, opp.custom?.[def.key]))}</div>)}
        </dl>
        {can('crm.edit') && (
          <div className="mt-4 max-w-xs border-t border-slate-100 pt-3">
            <Field label="Move to stage…" hint="Some stages need fields filled in first">
              <Select placeholder="Choose stage…" value="" disabled={moving} onChange={(e) => move(opp, e.target.value)}
                options={stages.filter((s) => s.id !== opp.stage_id).map((s) => ({ value: s.id, label: s.name }))} />
            </Field>
          </div>
        )}
      </section>

      <PaymentsPanel opportunityId={opp.id} />
      <AppointmentsPanel contactId={opp.contact_id} opportunityId={opp.id} />
      <ActivityTimeline opportunityId={opp.id} />

      <OpportunityFormModal open={editOpen || Boolean(fix)} onClose={() => { setEditOpen(false); setFix(null); }} opportunity={opp} pipelines={pipelines}
        missing={fix?.missing || []} onSaved={(updated) => (fix ? retryAfterFix(updated) : refresh())} />
      <BookAppointmentModal open={bookOpen} onClose={() => setBookOpen(false)} contactId={opp.contact_id} opportunityId={opp.id} onBooked={refresh} />
    </div>
  );
}
