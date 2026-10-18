// <BookAppointmentModal open onClose contactId opportunityId onBooked appointment? /> — owner: Ali (I3.3–I3.7).
// Book (or, with `appointment`, reschedule) on an employee's real Google Calendar. Shows their busy
// times for the chosen day and warns before overlapping; the server re-checks and can be overridden.
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost, qs } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input, Modal, Select } from './ui';

/** Offset (ms) of `tz` from UTC at instant `ts`. */
function tzOffset(ts, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - ts;
}
/** "2026-10-20" + "15:30" in `tz` → Date (exact instant). */
export function zonedToDate(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - tzOffset(guess, tz);
  ts = guess - tzOffset(ts, tz); // second pass handles DST edges
  return new Date(ts);
}
function partsIn(dateLike, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(dateLike)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const timeIn = (d, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(d));

const DURATIONS = [15, 30, 45, 60, 90, 120].map((m) => ({ value: String(m), label: m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}` }));
const CAL_STATUS = { ok: '', not_connected: 'calendar not connected', needs_reconnect: 'calendar needs reconnecting' };

export default function BookAppointmentModal({ open, onClose, contactId, opportunityId, onBooked, appointment }) {
  const { user } = useAuth();
  const tz = appointment?.timezone || user?.timezone || 'Asia/Karachi';
  const editing = Boolean(appointment);
  const { data: users } = useSWR(open ? '/users' : null, apiGet);

  const initial = () => {
    if (appointment) {
      const s = partsIn(appointment.starts_at, tz);
      const mins = Math.round((new Date(appointment.ends_at) - new Date(appointment.starts_at)) / 60000);
      return { user_id: appointment.user_id, title: appointment.title, date: s.date, time: s.time, duration: String(mins) };
    }
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    soon.setMinutes(soon.getMinutes() < 30 ? 30 : 60, 0, 0);
    const s = partsIn(soon, tz);
    return { user_id: '', title: 'Site visit / consultation', date: s.date, time: s.time, duration: '60' };
  };
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState({});
  const [conflicts, setConflicts] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(initial()); setErrors({}); setConflicts(null); } }, [open, appointment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setConflicts(null); };

  const start = useMemo(() => (f.date && f.time ? zonedToDate(f.date, f.time, tz) : null), [f.date, f.time, tz]);
  const end = start ? new Date(start.getTime() + Number(f.duration) * 60000) : null;
  const dayStart = f.date ? zonedToDate(f.date, '00:00', tz) : null;
  const dayEnd = dayStart ? new Date(dayStart.getTime() + 24 * 3600 * 1000) : null;

  const { data: busyRes, isLoading: busyLoading } = useSWR(
    open && f.user_id && dayStart ? `/calendar/busy${qs({ user_id: f.user_id, from: dayStart.toISOString(), to: dayEnd.toISOString() })}` : null,
    apiGet, { shouldRetryOnError: false },
  );
  const cal = busyRes?.data;
  const busySlots = (cal?.busy || []).filter((b) => !(appointment && new Date(b.start).getTime() === new Date(appointment.starts_at).getTime() && new Date(b.end).getTime() === new Date(appointment.ends_at).getTime()));
  const overlaps = start && end ? busySlots.filter((b) => new Date(b.start) < end && new Date(b.end) > start) : [];

  const employeeOptions = (users?.data || []).map((u) => ({
    value: u.id,
    label: `${u.name}${u.calendar_status && u.calendar_status !== 'ok' ? ` — ${CAL_STATUS[u.calendar_status] || u.calendar_status}` : ''}`,
    disabled: u.calendar_status !== 'ok',
  }));
  const anyConnected = employeeOptions.some((o) => !o.disabled);

  const submit = async (force = false) => {
    setBusy(true); setErrors({});
    try {
      const body = { title: f.title, starts_at: start.toISOString(), ends_at: end.toISOString(), timezone: tz, force };
      const { data } = editing
        ? await apiPatch(`/appointments/${appointment.id}`, { ...body, version: appointment.version })
        : await apiPost('/appointments', { ...body, contact_id: contactId, opportunity_id: opportunityId || null, user_id: f.user_id });
      toast.success(editing ? 'Appointment moved — Google Calendar updated' : 'Booked — it’s in their Google Calendar');
      onBooked?.(data);
      onClose();
    } catch (err) {
      if (err.status === 409 && err.details === undefined && /busy/i.test(err.message)) setConflicts(err.message);
      else { setErrors(err.details || {}); toast.error(err.message); }
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Reschedule appointment' : 'Book an appointment'} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      {conflicts
        ? <Button variant="danger" onClick={() => submit(true)} loading={busy}>Book anyway</Button>
        : <Button onClick={() => submit(false)} loading={busy} disabled={!start || (!editing && !f.user_id) || !f.title.trim()}>{editing ? 'Save new time' : 'Book'}</Button>}
    </>}>
      <div className="flex flex-col gap-3">
        {!editing && (
          <Field label="With" required error={errors.user_id} hint={!anyConnected && users ? 'Nobody has connected Google Calendar yet — each person connects theirs on their Profile.' : 'Only people with a connected Google Calendar can be booked'}>
            <Select placeholder="Choose an employee…" value={f.user_id} onChange={set('user_id')} options={employeeOptions} />
          </Field>
        )}
        <Field label="Title" required error={errors.title}><Input value={f.title} onChange={set('title')} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date" required error={errors.starts_at}><Input type="date" value={f.date} onChange={set('date')} /></Field>
          <Field label="Start" required><Input type="time" value={f.time} onChange={set('time')} step={900} /></Field>
          <Field label="Length" error={errors.ends_at}><Select value={f.duration} onChange={set('duration')} options={DURATIONS} /></Field>
        </div>
        <p className="text-xs text-slate-500">Times are in {tz}.{start && <> Ends at {timeIn(end, tz)}.</>}</p>

        {(f.user_id || editing) && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            {busyLoading && <p className="text-slate-500">Checking their calendar…</p>}
            {cal && cal.status !== 'ok' && <p className="text-amber-800">{cal.message || 'Their calendar isn’t available.'}</p>}
            {cal?.status === 'ok' && (busySlots.length === 0
              ? <p className="text-emerald-800">Free all day.</p>
              : (
                <>
                  <p className="font-medium text-slate-700">Busy that day:</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {busySlots.map((b) => <li key={b.start} className="rounded bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200">{timeIn(b.start, tz)} – {timeIn(b.end, tz)}</li>)}
                  </ul>
                </>
              ))}
            {overlaps.length > 0 && !conflicts && <p className="mt-2 font-medium text-red-700">⚠ This overlaps something already in their calendar.</p>}
          </div>
        )}
        {conflicts && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{conflicts}. You can pick another time, or book anyway.</p>}
      </div>
    </Modal>
  );
}
