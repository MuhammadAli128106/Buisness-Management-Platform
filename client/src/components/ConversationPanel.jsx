// <ConversationPanel contactId /> or <ConversationPanel conversationId /> — owner: Musa.
// Telegram two-way chat (I1.3, I1.4, I1.7, I1.9). Polls every 3 s (Q11).
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPost } from '../utils/api';
import { useCan } from '../hooks/useCan';
import { dateTime } from '../utils/format';
import { Badge, Button, Spinner, Textarea } from './ui';

const STATUS = {
  received: null, queued: ['gray', '⏳ Sending'], sent: ['blue', '✓ Sent'], delivered: ['green', '✓✓ Delivered'],
  read: ['green', '✓✓ Read'], failed: ['red', '⚠ Failed'], undelivered: ['red', '⚠ Not delivered'],
};

export default function ConversationPanel({ contactId, conversationId, height = 'h-80' }) {
  const can = useCan();
  const list = useSWR(!conversationId && contactId ? `/conversations?contact_id=${contactId}` : null, apiGet, { refreshInterval: 3000 });
  const convId = conversationId || list.data?.data?.[0]?.id;
  const thread = useSWR(convId ? `/conversations/${convId}/messages` : null, apiGet, { refreshInterval: 3000 });
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(null);
  const bottom = useRef(null);
  const messages = thread.data?.data?.messages || [];
  const conv = thread.data?.data?.conversation;
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const res = convId ? await apiPost(`/conversations/${convId}/messages`, { body }) : await apiPost(`/contacts/${contactId}/messages`, { body });
      if (res.data.status === 'failed') toast.error(`Not delivered: ${res.data.error_message}`); else toast.success('Message sent');
      setBody(''); list.mutate(); thread.mutate();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const retry = async (m) => {
    setRetrying(m.id);
    try { const r = await apiPost(`/messages/${m.id}/retry`); if (r.data.status === 'failed') toast.error(`Still failing: ${r.data.error_message}`); else toast.success('Message sent'); thread.mutate(); } catch (err) { toast.error(err.message); } finally { setRetrying(null); }
  };

  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Telegram conversation">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold text-slate-900">💬 Telegram conversation</h2>
        {conv?.assigned_user_name && <span className="text-xs text-slate-500">Assigned to {conv.assigned_user_name}</span>}
      </header>
      {conv?.opted_out && <p role="alert" className="mx-4 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">⛔ This contact opted out{conv.opted_out_reason ? ` — ${conv.opted_out_reason}` : ''}. Messaging is blocked until they send /start to the bot.</p>}
      <div className={`${height} overflow-y-auto px-4 py-3`} aria-live="polite">
        {(list.isLoading || thread.isLoading) && <div className="flex justify-center py-6"><Spinner /></div>}
        {!convId && !list.isLoading && <p className="py-6 text-center text-sm text-slate-500">No messages yet. Customers appear here after they message the company's Telegram bot.</p>}
        <ul className="flex flex-col gap-2">
          {messages.map((m) => {
            const mine = m.direction === 'out';
            const st = STATUS[m.status];
            return (
              <li key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-primary text-white' : 'bg-slate-100 text-slate-900'}`}>{m.body}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span>{mine ? (m.sender_name || 'Team') : 'Customer'} · {dateTime(m.created_at)}</span>
                  {mine && st && <Badge tone={st[0]}>{st[1]}</Badge>}
                </div>
                {['failed', 'undelivered'].includes(m.status) && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-red-700">
                    <span>{m.error_message}</span>
                    {can('crm.edit') && <Button size="sm" variant="secondary" loading={retrying === m.id} onClick={() => retry(m)}>Retry</Button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div ref={bottom} />
      </div>
      {can('crm.edit') && (
        <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-100 p-3">
          <label htmlFor={`msg-${contactId || conversationId}`} className="sr-only">Message</label>
          <Textarea id={`msg-${contactId || conversationId}`} rows={2} value={body} disabled={conv?.opted_out} placeholder={conv?.opted_out ? 'Opted out' : 'Type a reply…'}
            onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }} />
          <Button type="submit" loading={busy} disabled={!body.trim() || conv?.opted_out}>Send</Button>
        </form>
      )}
    </section>
  );
}
