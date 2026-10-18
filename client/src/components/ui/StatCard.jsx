/** <StatCard label value hint icon onClick tone /> — clickable when onClick given (drill-down, F5.3). */
export default function StatCard({ label, value, hint, icon, onClick, className = '' }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`flex w-full flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm ${onClick ? 'transition hover:border-primary hover:shadow-md focus-visible:ring-2' : ''} ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        {icon && <span aria-hidden="true" className="text-lg">{icon}</span>}
      </div>
      <span className="text-2xl font-semibold text-slate-900">{value}</span>
      {hint && <span className="text-xs text-slate-500">{hint}{onClick && <span className="ml-1 text-primary">View →</span>}</span>}
      {!hint && onClick && <span className="text-xs text-primary">View →</span>}
    </Tag>
  );
}
