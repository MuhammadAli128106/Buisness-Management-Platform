import Button from './Button';

/** <Pagination page limit total onChange={(p)=>…} /> */
export default function Pagination({ page = 1, limit = 25, total = 0, onChange }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return total ? <p className="mt-3 text-xs text-slate-500">{total} record{total === 1 ? '' : 's'}</p> : null;
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-slate-500">Page {page} of {pages} · {total} records</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>← Prev</Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next →</Button>
      </div>
    </nav>
  );
}
