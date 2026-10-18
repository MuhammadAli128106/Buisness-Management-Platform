// Payments — owner: Musa. All payment requests with status, traceability (I2.7) and filters.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { apiGet, qs } from '../utils/api';
import { dateTime, money } from '../utils/format';
import { PAY_STATUS } from '../components/PaymentsPanel';
import { Badge, DataTable, Field, PageHeader, Pagination, Select } from '../components/ui';

export default function Payments() {
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState(1);
  const status = sp.get('status') || '';
  const period = sp.get('period') || '';
  const { data, isLoading, error } = useSWR(`/payments${qs({ status, period, page, limit: 25 })}`, apiGet, { refreshInterval: 5000 });
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); setPage(1); };

  return (
    <div>
      <PageHeader title="Payments" subtitle="Google Pay payment requests (test environment). Statuses update automatically when customers pay." />
      <div className="mb-3 flex flex-wrap gap-3">
        <Field label="Status"><Select value={status} onChange={(e) => set('status', e.target.value)} placeholder="All" options={Object.entries(PAY_STATUS).map(([v, [, l]]) => ({ value: v, label: l }))} /></Field>
        <Field label="Period"><Select value={period} onChange={(e) => set('period', e.target.value)} placeholder="Any time" options={[{ value: 'this_month', label: 'Paid this month' }]} /></Field>
      </div>
      <DataTable loading={isLoading} error={error} rows={data?.data} empty="No payments match these filters" columns={[
        { key: 'amount', label: 'Amount', render: (p) => (p.value_masked ? 'Hidden' : money(p.amount_cents, p.currency)) },
        { key: 'status', label: 'Status', render: (p) => { const [t, l] = PAY_STATUS[p.status] || ['gray', p.status]; return <Badge tone={t}>{l}</Badge>; } },
        { key: 'contact_name', label: 'Customer', render: (p) => <Link className="text-primary" to={`/contacts/${p.contact_id}`}>{p.contact_name}</Link> },
        { key: 'opportunity_title', label: 'Opportunity', render: (p) => <Link className="text-primary" to={`/opportunities/${p.opportunity_id}`}>{p.opportunity_title}</Link> },
        { key: 'requested_by_name', label: 'Requested by' },
        { key: 'provider_ref', label: 'Provider ref', render: (p) => <code className="text-xs">{p.provider_ref || '—'}</code> },
        { key: 'created_at', label: 'Created', render: (p) => dateTime(p.created_at) },
        { key: 'paid_at', label: 'Paid', render: (p) => (p.paid_at ? dateTime(p.paid_at) : '—') },
      ]} />
      <Pagination page={page} limit={25} total={data?.total || 0} onChange={setPage} />
    </div>
  );
}
