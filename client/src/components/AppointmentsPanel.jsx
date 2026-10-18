// <AppointmentsPanel contactId opportunityId /> — owner: Ali (I3.3, I3.5, I3.6). List, book, reschedule, cancel.
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiDelete, apiGet, qs } from '../utils/api';
import { useCan } from '../hooks/useCan';
import { useAuth } from '../context/AuthContext';
import { dateTime } from '../utils/format';
import { Badge, Button, ConfirmDialog } from './ui';
import BookAppointmentModal from './BookAppointmentModal';

export default function AppointmentsPanel({ contactId, opportunityId }) {
  const can = useCan();
  const { user } = useAuth();
  const key = contactId || opportunityId ? `/appointments${qs({ contact_id: contactId, opportunity_id: opportunityId })}` : null;
  const { data, error, mutate } = useSWR(key, apiGet, { refreshInterval: 10000 });
  // An opportunity-only panel needs the opportunity's contact to book.
  const { data: opp } = useSWR(!contactId && opportunityId ? `/opportunities/${opportunityId}` : null, apiGet);
  const bookContact = contactId || opp?.data?.contact_id;

  const [booking, setBooking] = useState(false);
  const [editing, setEditing] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    setBusy(true);
    try { await apiDelete(`/appointments/${cancelling.id}`); toast.success('Cancelled — removed from Google Calendar'); setCancelling(null); mutate(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const rows = data?.data || [];
  const now = Date.now();
  const tz = user?.timezone;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Appointments</h2>
        {can('crm.edit') && bookContact && <Button size="sm" onClick={() => setBooking(true)}>+ Book</Button>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">Couldn’t load appointments: {error.message}</p>}
      {!error && rows.length === 0 && <p className="mt-2 text-sm text-slate-500">Nothing booked yet.</p>}
      <ul className="mt-2 divide-y divide-slate-100">
        {rows.map((a) => {
          const past = new Date(a.ends_at).getTime() < now;
          const cancelled = a.status === 'cancelled';
          return (
            <li key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className={`font-medium ${cancelled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{a.title}</p>
                <p className="text-sm text-slate-600">{dateTime(a.starts_at, tz)} · with {a.user_name}</p>
                {tz && a.timezone !== tz && <p className="text-xs text-slate-500">Booked in {a.timezone}: {dateTime(a.starts_at, a.timezone)}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {cancelled ? <Badge>Cancelled</Badge> : past ? <Badge tone="gray">Done</Badge> : <Badge tone="blue">Upcoming</Badge>}
                {!cancelled && !past && can('crm.edit') && <>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>Reschedule</Button>
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(a)}>Cancel</Button>
                </>}
              </div>
            </li>
          );
        })}
      </ul>

      <BookAppointmentModal open={booking} onClose={() => setBooking(false)} contactId={bookContact} opportunityId={opportunityId} onBooked={() => mutate()} />
      <BookAppointmentModal open={Boolean(editing)} appointment={editing} onClose={() => setEditing(null)} contactId={editing?.contact_id} onBooked={() => mutate()} />
      <ConfirmDialog open={Boolean(cancelling)} title="Cancel this appointment?" message={cancelling ? `${cancelling.title} with ${cancelling.user_name}. It will be removed from their Google Calendar.` : ''}
        confirmLabel="Cancel appointment" loading={busy} onConfirm={cancel} onCancel={() => setCancelling(null)} />
    </section>
  );
}
