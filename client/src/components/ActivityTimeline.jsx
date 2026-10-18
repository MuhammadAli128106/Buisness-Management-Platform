// Ahmed — activity timeline (F2.7). <ActivityTimeline contactId | opportunityId />. GET /activities, newest first.
// Every entry has an icon AND a text label (never icon-only), who did it, and when.
import useSWR from 'swr';
import { apiGet, qs } from '../utils/api';
import { dateTime, relative } from '../utils/format';
import { Spinner } from './ui';

const TYPES = {
  note: ['📝', 'Note'], stage_change: ['🔀', 'Stage change'], field_edit: ['✏️', 'Edited'], assignment: ['👤', 'Assigned'],
  lead_created: ['🆕', 'Lead created'], acknowledged: ['✅', 'Acknowledged'], escalation: ['⚠️', 'Escalated'],
  message_in: ['💬', 'Message received'], message_out: ['📤', 'Message sent'], payment: ['💳', 'Payment'], appointment: ['📅', 'Appointment'],
};
const humanize = (t) => String(t || 'activity').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function ActivityTimeline({ contactId, opportunityId }) {
  const key = opportunityId ? `/activities${qs({ opportunity_id: opportunityId })}` : contactId ? `/activities${qs({ contact_id: contactId })}` : null;
  const { data, error, isLoading } = useSWR(key, apiGet, { refreshInterval: 10000 });
  const items = data?.data || [];

  return (
    <section aria-labelledby="activity-heading" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="activity-heading" className="font-semibold text-slate-900">Activity</h2>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">Couldn&apos;t load activity: {error.message}</p>}
      {isLoading && !data && <div className="mt-3 flex justify-center"><Spinner label="Loading activity" /></div>}
      {data && items.length === 0 && <p className="mt-2 text-sm text-slate-500">Nothing has happened yet.</p>}
      {items.length > 0 && (
        <ol className="mt-3 flex flex-col">
          {items.map((a) => {
            const [icon, label] = TYPES[a.type] || ['•', humanize(a.type)];
            return (
              <li key={a.id} className="flex gap-3 border-l-2 border-slate-200 pb-4 pl-3 last:pb-0">
                <span aria-hidden="true" className="-ml-[1.35rem] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm">{icon}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{a.summary}</p>
                  <p className="text-xs text-slate-500">{a.actor_name || 'System'} · <time dateTime={a.created_at} title={dateTime(a.created_at)}>{relative(a.created_at)}</time></p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
