// Lead detail — owner: Ali (F3.4, F3.5, F2.7). Who has it, the timer, and the full routing history.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPost } from '../utils/api';
import { dateTime, duration } from '../utils/format';
import { Button, ConfirmDialog, EmptyState, PageHeader, Spinner } from '../components/ui';
import Countdown from '../components/Countdown';
import { LeadStatus, ReassignModal, SOURCE_LABEL } from './Leads';

const REASON = {
  initial: 'Assigned (round-robin)',
  escalation: 'Escalated — not acknowledged in time',
  absence: 'Moved — previous owner unavailable',
  manual: 'Reassigned by a manager',
  unassigned: 'Left without an owner',
};

export default function LeadDetail() {
  const { id } = useParams();
  const { data, error, isLoading, mutate } = useSWR(`/leads/${id}`, apiGet, { refreshInterval: 3000 });
  const [reassign, setReassign] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isLoading && !data) return <div className="flex justify-center p-10"><Spinner label="Loading lead" /></div>;
  if (error) return <EmptyState icon="🔎" title={error.status === 404 ? 'Lead not found' : 'Couldn’t load this lead'} body={error.status === 404 ? 'It may belong to someone else, or the link is wrong.' : error.message} action={<Link className="text-primary underline" to="/leads">Back to leads</Link>} />;
  const lead = data.data;

  const ack = async () => {
    setBusy(true);
    try { await apiPost(`/leads/${lead.id}/ack`); toast.success('Acknowledged'); mutate(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const close = async () => {
    try { await apiPost(`/leads/${lead.id}/close`); toast.success('Lead closed'); setClosing(false); mutate(); } catch (err) { toast.error(err.message); }
  };

  // How long each person held the lead: time until the next routing event (or until now, if they still have it).
  const history = lead.history || [];
  const held = history.map((h, i) => {
    const end = history[i + 1] ? new Date(history[i + 1].created_at) : (lead.status === 'closed' ? new Date(lead.updated_at) : new Date());
    return (end - new Date(h.created_at)) / 1000;
  });
  const firstResponse = lead.first_ack_at && lead.first_assigned_at
    ? (new Date(lead.first_ack_at) - new Date(lead.first_assigned_at)) / 1000 : null;

  return (
    <div className="mx-auto max-w-4xl">
      <p className="mb-2 text-sm"><Link to="/leads" className="text-primary hover:underline">← Leads</Link></p>
      <PageHeader
        title={lead.contact_name}
        subtitle={`${SOURCE_LABEL[lead.source] || lead.source}${lead.source_detail ? ` · ${lead.source_detail}` : ''} · came in ${dateTime(lead.created_at)}`}
        actions={<>
          {lead.can_ack && <Button onClick={ack} loading={busy}>Acknowledge</Button>}
          {lead.can_reassign && lead.status !== 'closed' && <Button variant="secondary" onClick={() => setReassign(true)}>Reassign</Button>}
          {lead.status !== 'closed' && <Button variant="ghost" onClick={() => setClosing(true)}>Close lead</Button>}
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
          <div className="mt-1.5"><LeadStatus status={lead.status} /></div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Accountable now</p>
          <p className="mt-1 font-medium text-slate-900">{lead.owner_name || <span className="text-red-700">Nobody</span>}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Time left to acknowledge</p>
          <p className="mt-1 text-lg">{lead.status === 'assigned' ? <Countdown secondsLeft={lead.seconds_left} /> : <span className="text-slate-400">—</span>}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">First response</p>
          <p className="mt-1 font-medium text-slate-900">{firstResponse !== null ? duration(firstResponse) : 'Not yet'}</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <span className="text-slate-500">Contact: </span>
        <Link to={`/contacts/${lead.contact_id}`} className="font-medium text-primary hover:underline">{lead.contact_name}</Link>
        {lead.contact_phone && <span className="text-slate-600"> · {lead.contact_phone}</span>}
        {lead.contact_email && <span className="text-slate-600"> · {lead.contact_email}</span>}
        {lead.opportunity_id && <> · <Link to={`/opportunities/${lead.opportunity_id}`} className="text-primary hover:underline">Opportunity</Link></>}
      </div>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-slate-900">Who had this lead</h2>
        <p className="text-sm text-slate-500">Every hand-off, why it happened, and how long each person held it. This record can’t be edited.</p>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No routing events yet.</p>
        ) : (
          <ol className="mt-4 border-l-2 border-slate-200">
            {history.map((h, i) => {
              const current = i === history.length - 1 && lead.status !== 'closed';
              return (
                <li key={h.id} className="relative mb-4 pl-5">
                  <span aria-hidden="true" className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 border-white ${current ? 'bg-primary' : h.reason === 'escalation' || h.reason === 'unassigned' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                  <p className="text-sm font-medium text-slate-900">
                    {h.to_name || 'Nobody'}
                    <span className="font-normal text-slate-500"> — {REASON[h.reason] || h.reason}{h.reason === 'escalation' ? ` (level ${h.level})` : ''}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {dateTime(h.created_at)}
                    {h.from_name ? ` · from ${h.from_name}` : ''}
                    {h.actor_name ? ` · by ${h.actor_name}` : ' · by the system'}
                    {' · '}{current ? `has had it for ${duration(held[i])}` : `held it for ${duration(held[i])}`}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {reassign && <ReassignModal lead={lead} onClose={() => setReassign(false)} onDone={() => mutate()} />}
      <ConfirmDialog
        open={closing}
        title="Close this lead?"
        message="Closing stops the timer and escalations. Do this when the lead is dealt with or not worth pursuing."
        confirmLabel="Close lead"
        onConfirm={close}
        onCancel={() => setClosing(false)}
      />
    </div>
  );
}
