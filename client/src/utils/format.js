// Display helpers — owner: Musa. Never format money/dates inline; use these.
export function money(cents, currency = 'USD') {
  if (cents === null || cents === undefined) return 'Hidden';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(currency || 'USD').toUpperCase(), maximumFractionDigits: 0 }).format(Number(cents) / 100);
  } catch { return `${(Number(cents) / 100).toFixed(0)} ${currency}`; }
}

/** Shows date+time in the viewer's timezone (or a given IANA zone) with the zone label (I3.5). */
// Note: dateStyle/timeStyle can't be combined with timeZoneName (browsers throw "Invalid option"),
// so the parts are spelled out. Never throws: a bad date or zone falls back to a plain string.
const DT_PARTS = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
export function dateTime(iso, timeZone) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return new Intl.DateTimeFormat(undefined, { ...DT_PARTS, timeZone: timeZone || undefined }).format(d);
  } catch {
    try { return new Intl.DateTimeFormat(undefined, DT_PARTS).format(d); } catch { return d.toISOString(); }
  }
}
export function dateOnly(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
}
export function relative(iso) {
  if (!iso) return '—';
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(s);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return rtf.format(s, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}
export function duration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
export const STATUS_LABELS = { available: 'Available', busy: 'Busy', on_leave: 'On leave', offline: 'Offline' };
