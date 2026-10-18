// Recovery queue — owner: Ali (F3.7). Leads that slipped through, with every reason shown as text.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { apiGet } from '../utils/api';
import { relative } from '../utils/format';
import { Badge, Button, DataTable, EmptyState, PageHeader, Pagination } from '../components/ui';
import Countdown from '../components/Countdown';
import { LeadStatus, ReassignModal, SOURCE_LABEL } from './Leads';

export default function Recovery() {
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [reassign, setReassign] = useState(null);
  const { data, error, isLoading, mutate } = useSWR(`/leads/recovery?page=${page}&limit=25`, apiGet, { refreshInterval: 3000 });

  return (
    <div>
      <PageHeader
        title="Recovery queue"
        subtitle="Leads with no owner, past their acknowledgement window, escalated twice or more, or left idle. Give each one to someone who can act on it."
      />
      <DataTable
        loading={isLoading}
        error={error}
        rows={data?.data}
        onRowClick={(l) => nav(`/leads/${l.id}`)}
        empty={<EmptyState icon="🎉" title="Nothing to recover" body="Every lead has an owner who is acting on it." />}
        columns={[
          { key: 'contact_name', label: 'Lead', render: (l) => (
            <div>
              <p className="font-medium text-slate-900">{l.contact_name}</p>
              <p className="text-xs text-slate-500">{SOURCE_LABEL[l.source] || l.source} · {relative(l.created_at)}</p>
            </div>
          ) },
          { key: 'reasons', label: 'Why it’s here', render: (l) => (
            <div className="flex flex-wrap gap-1">{l.reasons.map((r) => <Badge key={r} tone={/owner|window/i.test(r) ? 'red' : 'yellow'}>{r}</Badge>)}</div>
          ) },
          { key: 'owner_name', label: 'Owner', render: (l) => l.owner_name || <span className="text-red-700">Nobody</span> },
          { key: 'status', label: 'Status', render: (l) => (
            <div className="flex flex-col gap-1"><LeadStatus status={l.status} />{l.status === 'assigned' && <Countdown secondsLeft={l.seconds_left} className="text-xs" />}</div>
          ) },
          { key: 'actions', label: <span className="sr-only">Actions</span>, render: (l) => (
            <Button size="sm" onClick={(e) => { e.stopPropagation(); setReassign(l); }}>Assign</Button>
          ) },
        ]}
      />
      <Pagination page={page} limit={25} total={data?.total || 0} onChange={setPage} />
      <ReassignModal lead={reassign} onClose={() => setReassign(null)} onDone={() => mutate()} />
    </div>
  );
}
