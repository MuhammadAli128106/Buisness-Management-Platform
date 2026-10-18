import Spinner from './Spinner';
import EmptyState from './EmptyState';

/**
 * <DataTable columns={[{key,label,render:(row)=>node, className}]} rows loading empty={<EmptyState/>|'text'} onRowClick rowKey="id" />
 * Table on ≥md screens, stacked cards on phones — no horizontal page scroll (Q7).
 */
export default function DataTable({ columns, rows, loading, empty, onRowClick, rowKey = 'id', error }) {
  if (error) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Couldn&apos;t load: {error.message || String(error)}</div>;
  if (loading && !rows) return <div className="flex justify-center rounded-xl border border-slate-200 bg-white p-10"><Spinner label="Loading records" /></div>;
  if (!rows || rows.length === 0) return typeof empty === 'string' || !empty ? <EmptyState title={empty || 'No records found'} /> : empty;
  const cell = (c, r) => (c.render ? c.render(r) : (r[c.key] ?? '—'));
  const clickProps = (r) => (onRowClick ? {
    onClick: () => onRowClick(r), onKeyDown: (e) => { if (e.key === 'Enter') onRowClick(r); }, tabIndex: 0, role: 'link',
  } : {});
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>{columns.map((c) => <th key={c.key} scope="col" className={`px-4 py-2.5 font-medium ${c.className || ''}`}>{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r[rowKey]} {...clickProps(r)} className={onRowClick ? 'cursor-pointer hover:bg-blue-50/50 focus:bg-blue-50' : ''}>
                {columns.map((c) => <td key={c.key} className={`px-4 py-3 align-top text-slate-700 ${c.className || ''}`}>{cell(c, r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((r) => (
          <li key={r[rowKey]} {...clickProps(r)} className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${onRowClick ? 'cursor-pointer active:bg-blue-50' : ''}`}>
            {columns.map((c, i) => (
              <div key={c.key} className={i === 0 ? 'mb-1 font-medium text-slate-900' : 'flex justify-between gap-3 py-0.5 text-sm'}>
                {i !== 0 && <span className="shrink-0 text-slate-500">{c.label}</span>}
                <span className={i === 0 ? '' : 'min-w-0 text-right text-slate-700'}>{cell(c, r)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
      {loading && <p className="mt-2 text-xs text-slate-500">Refreshing…</p>}
    </>
  );
}
