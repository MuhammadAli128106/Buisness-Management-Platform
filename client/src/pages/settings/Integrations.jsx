// Integrations (I5.1, I5.4, I5.6, I5.7, I4.4) — owner: Musa.
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPut, qs } from '../../utils/api';
import { dateTime, relative } from '../../utils/format';
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, Pagination, Select, Spinner } from '../../components/ui';

const STATUS = { connected: ['green', '● Connected'], error: ['red', '▲ Error'], not_connected: ['gray', '○ Not connected'] };
const FIELDS = {
  telegram: [['bot_token', 'Bot token from @BotFather', '123456:ABC…', 'password']],
  googlepay: [['merchant_name', 'Business name shown in Google Pay', 'Acme Solar']],
};
const EV_TONE = { ok: 'green', duplicate: 'blue', error: 'red', rejected: 'red', retrying: 'yellow' };

function CopyRow({ label, value }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
      <span className="w-24 shrink-0 text-xs font-medium text-slate-500">{label}</span>
      <code className="min-w-0 flex-1 break-all rounded bg-slate-100 px-2 py-1 text-xs">{value}</code>
      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(value); toast.success('Copied'); }}>Copy</Button>
    </div>
  );
}

function ProviderCard({ p, onConfigure, onDisconnect }) {
  const [tone, label] = STATUS[p.status] || STATUS.not_connected;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">{p.name}</h2>
          <p className="text-sm text-slate-500">{p.purpose}</p>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-xs text-slate-500">Last worked</dt><dd>{p.last_ok_at ? <span title={dateTime(p.last_ok_at)}>{relative(p.last_ok_at)}</span> : 'Never'}</dd></div>
        <div><dt className="text-xs text-slate-500">Last error</dt><dd className="truncate" title={p.last_error || ''}>{p.last_error_at ? relative(p.last_error_at) : 'None'}</dd></div>
        {Object.entries(p.config_hint || {}).map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k.replace(/_/g, ' ')}</dt><dd className="font-mono text-xs">{String(v)}</dd></div>)}
        {p.provider === 'google' && <div className="col-span-2"><dt className="text-xs text-slate-500">Employees connected</dt><dd>{p.users_connected} of {p.users_total}{p.users_needing_reconnect ? ` · ${p.users_needing_reconnect} need to reconnect` : ''}</dd></div>}
      </dl>
      {p.last_error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">⚠ {p.last_error}</p>}
      {p.webhook_urls && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Webhook URL</p>
          {Object.entries(p.webhook_urls).map(([k, v]) => <CopyRow key={k} label={k} value={v} />)}
          {p.webhook_note && <p className="text-xs text-slate-500">{p.webhook_note}</p>}
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">What this integration can and cannot do</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">{p.limits.map((l) => <li key={l}>{l}</li>)}</ul>
      </details>
      {p.recent_errors?.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-red-700">Recent errors ({p.recent_errors.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">{p.recent_errors.map((e, i) => <li key={i}><span className="text-slate-400">{relative(e.created_at)} · {e.kind}:</span> {e.error}</li>)}</ul>
        </details>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        {p.configurable ? (
          <>
            <Button size="sm" onClick={() => onConfigure(p)}>{p.status === 'not_connected' ? 'Connect' : 'Update credentials'}</Button>
            {p.status !== 'not_connected' && <Button size="sm" variant="ghost" onClick={() => onDisconnect(p)}>Disconnect</Button>}
          </>
        ) : <p className="text-xs text-slate-500">Each employee connects their own account from their Profile page.</p>}
      </div>
    </section>
  );
}

export default function Integrations() {
  const { data, isLoading, mutate } = useSWR('/integrations', apiGet, { refreshInterval: 10000 });
  const [filters, setFilters] = useState({ provider: '', status: '', page: 1 });
  const events = useSWR(`/integration-events${qs({ ...filters, limit: 20 })}`, apiGet, { refreshInterval: 5000 });
  const failedAlerts = useSWR('/notifications?status=failed', apiGet, { shouldRetryOnError: false });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const open = (p) => { setEditing(p); setForm({}); setErrors({}); };
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({});
    try {
      const r = await apiPut(`/integrations/${editing.provider}`, form).catch((x) => { throw x; });
      if (r.data?.warning) toast.warning(r.data.warning); else toast.success(`${editing.name} connected — verified with the provider`);
      setEditing(null); mutate(); events.mutate();
    } catch (err) { setErrors(err.details || {}); toast.error(err.message); } finally { setBusy(false); }
  };
  const disconnect = async (p) => {
    if (!window.confirm(`Disconnect ${p.name}? It will stop working for everyone in this workspace.`)) return;
    try { await apiDelete(`/integrations/${p.provider}`); toast.success(`${p.name} disconnected`); mutate(); } catch (err) { toast.error(err.message); }
  };

  if (isLoading) return <div className="flex justify-center p-10"><Spinner /></div>;
  const failed = failedAlerts.data?.data || [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Integrations" subtitle={<>Each workspace uses its own credentials. Secrets are encrypted on the server and never shown in full. Workspace ID: <code className="text-xs">{data?.workspace_id}</code></>} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(data?.data || []).map((p) => <ProviderCard key={p.provider} p={p} onConfigure={open} onDisconnect={disconnect} />)}
      </div>

      {failed.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">Failed escalation alerts</h2>
          <DataTable rows={failed} columns={[
            { key: 'body', label: 'Alert', render: (n) => <span className="line-clamp-2">{n.body}</span> },
            { key: 'attempts', label: 'Attempts' },
            { key: 'last_error', label: 'Reason' },
            { key: 'created_at', label: 'When', render: (n) => relative(n.created_at) },
          ]} />
        </section>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Synchronisation history</h2>
          <div className="flex flex-wrap gap-2">
            <Field label="Provider"><Select value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value, page: 1 })} placeholder="All" options={['telegram', 'googlepay', 'google'].map((v) => ({ value: v, label: v }))} /></Field>
            <Field label="Result"><Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })} placeholder="All" options={['ok', 'error', 'rejected', 'duplicate'].map((v) => ({ value: v, label: v }))} /></Field>
          </div>
        </div>
        <DataTable loading={events.isLoading} rows={events.data?.data} empty="No events yet — they appear as soon as a provider sends or receives something." columns={[
          { key: 'created_at', label: 'Time', render: (e) => <span title={dateTime(e.created_at)}>{relative(e.created_at)}</span> },
          { key: 'provider', label: 'Provider' },
          { key: 'direction', label: 'Dir', render: (e) => (e.direction === 'in' ? '⬇ in' : '⬆ out') },
          { key: 'kind', label: 'Event' },
          { key: 'status', label: 'Result', render: (e) => <Badge tone={EV_TONE[e.status]}>{e.status}</Badge> },
          { key: 'external_id', label: 'Reference', render: (e) => <code className="break-all text-xs">{e.external_id || '—'}</code> },
          { key: 'error', label: 'Detail', render: (e) => <span className="text-xs text-slate-600">{e.error || ''}</span> },
        ]} />
        <Pagination page={filters.page} limit={20} total={events.data?.total || 0} onChange={(page) => setFilters({ ...filters, page })} />
      </section>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Connect ${editing?.name || ''}`}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="int-form" loading={busy}>Verify & save</Button></>}>
        {editing && (
          <form id="int-form" onSubmit={save} className="flex flex-col gap-3">
            <p className="text-sm text-slate-500">We test these with the provider before saving. They are stored encrypted and only the last 4 characters are ever shown again.</p>
            {FIELDS[editing.provider].map(([key, label, ph, type]) => (
              <Field key={key} label={label} required error={errors[key]}>
                <Input type={type || 'text'} autoComplete="off" placeholder={ph} value={form[key] || ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </Field>
            ))}
          </form>
        )}
      </Modal>
    </div>
  );
}
