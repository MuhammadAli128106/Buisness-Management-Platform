// Availability switch in the TopBar — owner: Ali (F3.2, F3.6). PATCH /me/status.
import { useState } from 'react';
import { toast } from 'sonner';
import { apiPatch } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const OPTIONS = [
  { value: 'available', label: 'Available', dot: 'bg-emerald-500' },
  { value: 'busy', label: 'Busy', dot: 'bg-amber-500' },
  { value: 'on_leave', label: 'On leave', dot: 'bg-violet-500' },
  { value: 'offline', label: 'Offline', dot: 'bg-slate-400' },
];

export default function AvailabilityToggle() {
  const { user, setUser } = useAuth();
  const [saving, setSaving] = useState(false);
  if (!user) return null;
  const current = OPTIONS.find((o) => o.value === user.status) || OPTIONS[0];

  const change = async (e) => {
    const status = e.target.value;
    if (status === user.status) return;
    setSaving(true);
    try {
      const { data } = await apiPatch('/me/status', { status });
      setUser({ ...user, status });
      toast.success(`You're now ${OPTIONS.find((o) => o.value === status)?.label.toLowerCase()}`, data?.message ? { description: data.message } : undefined);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className="relative flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1 pl-2.5 pr-1 text-sm text-slate-700">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${current.dot}`} />
      <span className="sr-only">Your availability</span>
      <select
        value={user.status}
        onChange={change}
        disabled={saving}
        className="cursor-pointer appearance-none bg-transparent pr-5 text-sm font-medium focus:outline-none disabled:opacity-60"
        title="Only Available people get new leads. Going On leave or Offline hands your unacknowledged leads to colleagues."
      >
        {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2 text-xs text-slate-400">▾</span>
    </label>
  );
}
