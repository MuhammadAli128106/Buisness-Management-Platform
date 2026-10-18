// Inbox — owner: Musa. Telegram conversations list + thread (I1). Polls every 3 s.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import { apiGet } from '../utils/api';
import { relative } from '../utils/format';
import ConversationPanel from '../components/ConversationPanel';
import { Badge, Checkbox, EmptyState, PageHeader, Spinner } from '../components/ui';

export default function Inbox() {
  const { conversationId } = useParams();
  const nav = useNavigate();
  const [mine, setMine] = useState(false);
  const { data, isLoading, error } = useSWR(`/conversations${mine ? '?mine=1' : ''}`, apiGet, { refreshInterval: 3000 });
  const convs = data?.data || [];
  const active = convs.find((c) => c.id === conversationId);

  return (
    <div>
      <PageHeader title="Inbox" subtitle="Customer conversations from the company Telegram bot. New messages appear automatically."
        actions={<Checkbox label="Only mine" checked={mine} onChange={(e) => setMine(e.target.checked)} />} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className={`${conversationId ? 'hidden lg:block' : ''}`}>
          {isLoading && <div className="flex justify-center p-8"><Spinner /></div>}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error.message}</p>}
          {!isLoading && convs.length === 0 && <EmptyState icon="💬" title="No conversations yet" body="When a customer messages the Telegram bot, a contact and lead are created and the chat shows up here." />}
          <ul className="flex flex-col gap-1.5">
            {convs.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => nav(`/inbox/${c.id}`)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${c.id === conversationId ? 'border-primary bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-900">{c.contact_name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{relative(c.last_message_at)}</span>
                  </div>
                  <p className="truncate text-sm text-slate-500">{c.last_direction === 'out' ? 'You: ' : ''}{c.last_message || '—'}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.assigned_user_name && <Badge>{c.assigned_user_name}</Badge>}
                    {c.opted_out && <Badge tone="yellow">Opted out</Badge>}
                    {c.failed_count > 0 && <Badge tone="red">{c.failed_count} failed</Badge>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className={conversationId ? '' : 'hidden lg:block'}>
          {conversationId ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <Link to="/inbox" className="text-sm text-primary lg:hidden">← All conversations</Link>
                {active && <Link to={`/contacts/${active.contact_id}`} className="text-sm text-primary">Open contact →</Link>}
              </div>
              <ConversationPanel conversationId={conversationId} height="h-[55vh]" />
            </>
          ) : <EmptyState icon="👈" title="Pick a conversation" />}
        </div>
      </div>
    </div>
  );
}
