// <PaymentsPanel opportunityId /> or <PaymentsPanel contactId /> — owner: Musa. Google Pay (TEST) payment requests (I2).
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPost, qs } from '../utils/api';
import { useCan } from '../hooks/useCan';
import { dateTime, money, relative } from '../utils/format';
import { Badge, Button, Field, Input, Modal, Spinner } from './ui';

export const PAY_STATUS = {
  pending: ['yellow', '⏳ Awaiting payment'], paid: ['green', '✓ Paid'], expired: ['gray', '⌛ Expired'], failed: ['red', '⚠ Failed'],
  refunded: ['purple', '↩ Refunded'], partially_refunded: ['purple', '↩ Partly refunded'],
};

export default function PaymentsPanel({ opportunityId, contactId, currency = 'PKR' }) {
  const can = useCan();
  const key = `/payments${qs({ opportunity_id: opportunityId, contact_id: contactId, limit: 50 })}`;
  const { data, isLoading, mutate } = useSWR(key, apiGet, { refreshInterval: 3000 });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: '', description: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [refund, setRefund] = useState(null);
  const rows = data?.data || [];

  const create = async (e) => {
    e.preventDefault();
    const amount = Math.round(Number(form.amount) * 100);
    if (!(amount > 0)) { setErrors({ amount: 'Enter an amount' }); return; }
    setBusy(true); setErrors({});
    try {
      const r = await apiPost(`/opportunities/${opportunityId}/payments`, { amount_cents: amount, currency, description: form.description || undefined });
      toast.success('Payment link created'); setOpen(false); setForm({ amount: '', description: '' }); mutate();
      navigator.clipboard?.writeText(r.data.checkout_url).catch(() => {});
    } catch (err) { setErrors(err.details || {}); toast.error(err.message); } finally { setBusy(false); }
  };
  const sendLink = async (p) => {
    try { const r = await apiPost(`/payments/${p.id}/send`); if (r.data.status === 'failed') toast.error(`Not delivered: ${r.data.error_message}`); else toast.success('Link sent on Telegram'); } catch (err) { toast.error(err.message); }
  };
  const doRefund = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await apiPost(`/payments/${refund.p.id}/refund`, { amount_cents: Math.round(Number(refund.amount) * 100), reason: refund.reason }); toast.success('Refund recorded'); setRefund(null); mutate(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Payments">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">💳 Payments</h2>
        {opportunityId && can('crm.edit') && <Button size="sm" onClick={() => setOpen(true)}>+ Request payment</Button>}
      </div>
      {isLoading && <div className="flex justify-center py-4"><Spinner /></div>}
      {!isLoading && rows.length === 0 && <p className="text-sm text-slate-500">No payment requests yet.{opportunityId ? ' Create one to send the customer a Google Pay link.' : ''}</p>}
      <ul className="flex flex-col divide-y divide-slate-100">
        {rows.map((p) => {
          const [tone, label] = PAY_STATUS[p.status] || ['gray', p.status];
          return (
            <li key={p.id} className="flex flex-col gap-1 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{p.value_masked ? 'Amount hidden' : money(p.amount_cents, p.currency)}{p.refunded_cents > 0 && !p.value_masked && <span className="text-xs text-slate-500"> (refunded {money(p.refunded_cents, p.currency)})</span>}</span>
                <Badge tone={tone}>{label}</Badge>
              </div>
              <p className="text-xs text-slate-500">{p.description || p.opportunity_title} · requested by {p.requested_by_name} {relative(p.created_at)}{p.provider_ref && <> · ref <code>{p.provider_ref}</code></>}{p.paid_at && <> · paid {dateTime(p.paid_at)}</>}</p>
              {p.failure_reason && p.status !== 'paid' && <p className="text-xs text-red-700">{p.failure_reason}</p>}
              <div className="flex flex-wrap gap-2">
                {p.status === 'pending' && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(p.checkout_url); toast.success('Link copied'); }}>Copy link</Button>
                    <a href={p.checkout_url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-blue-50">Open pay page ↗</a>
                    {can('crm.edit') && <Button size="sm" variant="ghost" onClick={() => sendLink(p)}>Send via Telegram</Button>}
                  </>
                )}
                {['paid', 'partially_refunded'].includes(p.status) && can('crm.edit') && can('opp.value.view') && (
                  <Button size="sm" variant="ghost" onClick={() => setRefund({ p, amount: ((p.amount_cents - p.refunded_cents) / 100).toFixed(2), reason: '' })}>Record refund</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Modal open={open} onClose={() => setOpen(false)} title="Request a payment"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form="pay-form" loading={busy}>Create link</Button></>}>
        <form id="pay-form" onSubmit={create} className="flex flex-col gap-3">
          <Field label={`Amount (${currency})`} required error={errors.amount || errors.amount_cents}><Input type="number" min="1" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Description" hint="Shown to the customer on the payment page"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <p className="text-xs text-slate-500">The customer pays on a secure Google Pay page (test environment). The link expires after 30 minutes and the status here updates on its own.</p>
        </form>
      </Modal>
      <Modal open={Boolean(refund)} onClose={() => setRefund(null)} title="Record a refund" size="sm"
        footer={<><Button variant="secondary" onClick={() => setRefund(null)}>Cancel</Button><Button type="submit" form="refund-form" loading={busy}>Record refund</Button></>}>
        {refund && (
          <form id="refund-form" onSubmit={doRefund} className="flex flex-col gap-3">
            <Field label={`Amount (${refund.p.currency})`} required><Input type="number" step="0.01" min="0.01" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} /></Field>
            <Field label="Reason" required><Input value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /></Field>
            <p className="text-xs text-slate-500">Google Pay&apos;s test environment has no refund API, so refunds are recorded here and logged in the audit history.</p>
          </form>
        )}
      </Modal>
    </section>
  );
}
