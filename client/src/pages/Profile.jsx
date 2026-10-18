// Profile — owner: Ali (F3.2, I4.3, I3.1, I3.7). Availability, Telegram alerts, Google Calendar.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Field, Input, PageHeader } from '../components/ui';
import AvailabilityToggle from '../components/AvailabilityToggle';

function Card({ title, children, aside }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function TelegramCard() {
  const { data, mutate } = useSWR('/me/telegram', apiGet);
  const [chatId, setChatId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => { if (data?.data) setChatId(data.data.chat_id || ''); }, [data]);
  const saved = data?.data?.chat_id;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try { await apiPut('/me/telegram', { chat_id: chatId.trim() }); toast.success(chatId.trim() ? 'Telegram chat ID saved' : 'Telegram alerts turned off'); mutate(); } catch (err) { setError(err.details?.chat_id || err.message); } finally { setSaving(false); }
  };
  const test = async () => {
    setTesting(true);
    try { await apiPost('/me/telegram/test'); toast.success('Test message sent — check Telegram'); } catch (err) { toast.error(err.message); } finally { setTesting(false); }
  };

  return (
    <Card title="Telegram escalation alerts" aside={saved ? <Badge tone="green">Connected</Badge> : <Badge>Not set up</Badge>}>
      {data?.data && !data.data.bot_connected && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Your workspace hasn’t connected a Telegram bot yet. An Admin can add it under Settings → Integrations.</p>
      )}
      <ol className="mb-4 list-decimal space-y-0.5 pl-5 text-sm text-slate-600">
        <li>Open your company’s bot in Telegram and send <code className="rounded bg-slate-100 px-1">/myid</code>.</li>
        <li>Paste the number it replies with below and save.</li>
        <li>Press “Send test” to make sure it arrives.</li>
      </ol>
      <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Telegram chat ID" error={error} className="flex-1">
          <Input value={chatId} onChange={(e) => setChatId(e.target.value)} inputMode="numeric" placeholder="e.g. 123456789" />
        </Field>
        <Button type="submit" loading={saving}>Save</Button>
        <Button variant="secondary" onClick={test} loading={testing} disabled={!saved}>Send test</Button>
      </form>
    </Card>
  );
}

function GoogleCard() {
  const { user } = useAuth();
  const { data, mutate } = useSWR('/integrations/google/status', apiGet, { shouldRetryOnError: false });
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const status = data?.data?.status || 'not_connected';

  useEffect(() => {
    if (params.get('google') === 'connected') toast.success('Google Calendar connected');
    if (params.get('google') === 'error') toast.error(params.get('reason') || 'Google Calendar could not be connected');
  }, [params]);

  const disconnect = async () => {
    setBusy(true);
    try { await apiDelete('/integrations/google'); toast.success('Google Calendar disconnected'); mutate(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const badge = status === 'ok' ? <Badge tone="green">Connected</Badge>
    : status === 'needs_reconnect' ? <Badge tone="red">Needs reconnecting</Badge> : <Badge>Not connected</Badge>;

  return (
    <Card title="Google Calendar" aside={badge}>
      <p className="text-sm text-slate-600">
        {status === 'ok' && <>Connected as <strong>{data.data.google_email}</strong>. Appointments booked for you appear in this calendar, and your busy times stop double bookings.</>}
        {status === 'needs_reconnect' && 'Google stopped accepting our access (revoked or expired). Reconnect to keep booking appointments.'}
        {status === 'not_connected' && 'Connect your Google Calendar so colleagues can book customer appointments with you. Until you do, you can’t be booked.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {status !== 'ok' && <Button onClick={() => window.location.assign('/api/v1/integrations/google/connect')}>{status === 'needs_reconnect' ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</Button>}
        {status !== 'not_connected' && <Button variant="secondary" onClick={disconnect} loading={busy}>Disconnect</Button>}
      </div>
      <p className="mt-3 text-xs text-slate-500">The app is in Google’s testing mode, so only accounts added as test users can connect. Times are shown in your timezone ({user?.timezone || 'Asia/Karachi'}).</p>
    </Card>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const { data: rules } = useSWR('/assignment-rules', apiGet);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="Your profile" subtitle={`${user?.name} · ${user?.email}`} />
      <Card title="Availability" aside={<AvailabilityToggle />}>
        <ul className="space-y-1 text-sm text-slate-600">
          <li><strong>Available</strong> — you receive new leads (up to the team’s limit).</li>
          <li><strong>Busy</strong> — you keep your leads but get no new ones.</li>
          <li><strong>On leave / Offline</strong> — leads you haven’t acknowledged move to a colleague immediately{rules?.data ? `; acknowledged ones ${rules.data.on_absence_acknowledged === 'reassign' ? 'move too' : 'stay with you'}` : ''}.</li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">Timezone: {user?.timezone || 'Asia/Karachi'}</p>
      </Card>
      <TelegramCard />
      <GoogleCard />
    </div>
  );
}
