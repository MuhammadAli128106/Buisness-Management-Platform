// Assignment & escalation rules — owner: Ali (F3.3, F3.5, F3.6). All timers in seconds so they can be demoed live.
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPut } from '../../utils/api';
import { useCan } from '../../hooks/useCan';
import { duration } from '../../utils/format';
import { Button, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';

const TARGETS = [
  { value: 'next', label: 'Next available employee' },
  { value: 'backup', label: 'The first owner’s backup' },
  { value: 'manager', label: 'The first owner’s manager' },
];
const TARGET_SHORT = { next: 'the next available person', backup: 'their backup', manager: 'their manager' };

function Preview({ r }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
      <li>A new lead goes to the next <strong>Available</strong> person with fewer than <strong>{r.max_open_leads}</strong> open leads.</li>
      <li>They have <strong>{duration(r.ack_window_seconds)}</strong> to acknowledge it.</li>
      {r.escalation.map((s, i) => (
        <li key={i}>If nobody acknowledges, it goes to <strong>{TARGET_SHORT[s.to]}</strong>, who has <strong>{duration(s.seconds)}</strong>.</li>
      ))}
      <li>After that it has no owner and waits in the <strong>recovery queue</strong> for a manager.</li>
      <li>Anyone who goes On leave or Offline loses their unacknowledged leads immediately; acknowledged ones {r.on_absence_acknowledged === 'reassign' ? 'move too' : 'stay with them'}.</li>
    </ol>
  );
}

export default function AssignmentRules() {
  const can = useCan();
  const editable = can('rules.manage');
  const { data, error, mutate } = useSWR('/assignment-rules', apiGet);
  const [r, setR] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data?.data) setR(JSON.parse(JSON.stringify(data.data))); }, [data]);

  if (error) return <p role="alert" className="text-red-700">{error.message}</p>;
  if (!r) return <div className="flex justify-center p-10"><Spinner label="Loading rules" /></div>;

  const num = (k) => (e) => setR({ ...r, [k]: e.target.value === '' ? '' : Number(e.target.value) });
  const setStep = (i, patch) => setR({ ...r, escalation: r.escalation.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i, d) => {
    const esc = [...r.escalation];
    [esc[i], esc[i + d]] = [esc[i + d], esc[i]];
    setR({ ...r, escalation: esc });
  };

  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await apiPut('/assignment-rules', r);
      toast.success('Rules saved. They apply to the next lead and the next timer.');
      mutate();
    } catch (err) { setErrors(err.details || {}); toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Assignment rules"
        subtitle="Who gets new leads, how long they have, and where a lead goes if it’s ignored."
        actions={editable && <Button onClick={save} loading={busy}>Save rules</Button>}
      />
      {!editable && <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">You can view these rules. Changing them needs the “rules.manage” permission.</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Distribution</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Max open leads per person" error={errors.max_open_leads} hint="People at the limit are skipped">
            <Input type="number" min={1} value={r.max_open_leads} onChange={num('max_open_leads')} disabled={!editable} />
          </Field>
          <Field label="Time to acknowledge (seconds)" error={errors.ack_window_seconds} hint={duration(r.ack_window_seconds || 0)}>
            <Input type="number" min={5} value={r.ack_window_seconds} onChange={num('ack_window_seconds')} disabled={!editable} />
          </Field>
          <Field label="Idle after (seconds)" error={errors.idle_seconds} hint={`No action for ${duration(r.idle_seconds || 0)} → recovery queue`}>
            <Input type="number" min={30} value={r.idle_seconds} onChange={num('idle_seconds')} disabled={!editable} />
          </Field>
        </div>
        <Field label="When someone goes on leave, leads they already acknowledged…" className="mt-4 sm:max-w-md">
          <Select value={r.on_absence_acknowledged} onChange={(e) => setR({ ...r, on_absence_acknowledged: e.target.value })} disabled={!editable}
            options={[{ value: 'keep', label: 'Stay with them' }, { value: 'reassign', label: 'Move to a colleague too' }]} />
        </Field>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Escalation chain</h2>
          {editable && r.escalation.length < 6 && (
            <Button size="sm" variant="secondary" onClick={() => setR({ ...r, escalation: [...r.escalation, { to: 'manager', seconds: 60 }] })}>+ Add level</Button>
          )}
        </div>
        {errors.escalation && <p className="mt-2 text-sm text-red-700">⚠ {errors.escalation}</p>}
        <ol className="mt-3 flex flex-col gap-2">
          {r.escalation.map((s, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-end">
              <span className="text-sm font-medium text-slate-500 sm:w-16 sm:pb-2">Level {i + 1}</span>
              <Field label="Goes to" className="flex-1">
                <Select value={s.to} onChange={(e) => setStep(i, { to: e.target.value })} options={TARGETS} disabled={!editable} />
              </Field>
              <Field label="They have (seconds)" className="sm:w-40" error={errors[`escalation.${i}.seconds`]}>
                <Input type="number" min={5} value={s.seconds} onChange={(e) => setStep(i, { seconds: e.target.value === '' ? '' : Number(e.target.value) })} disabled={!editable} />
              </Field>
              {editable && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move level ${i + 1} up`}>↑</Button>
                  <Button size="sm" variant="ghost" disabled={i === r.escalation.length - 1} onClick={() => move(i, 1)} aria-label={`Move level ${i + 1} down`}>↓</Button>
                  <Button size="sm" variant="ghost" disabled={r.escalation.length === 1} onClick={() => setR({ ...r, escalation: r.escalation.filter((_, j) => j !== i) })} aria-label={`Remove level ${i + 1}`}>Remove</Button>
                </div>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-slate-500">A level whose person is missing, on leave or offline is skipped automatically.</p>
      </section>

      <section className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-5">
        <h2 className="mb-2 font-semibold text-slate-900">What will happen to the next lead</h2>
        <Preview r={{ ...r, escalation: r.escalation.filter((s) => Number(s.seconds) > 0) }} />
      </section>
    </div>
  );
}
