const TONES = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200', green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-200', red: 'bg-red-50 text-red-800 ring-red-200',
  blue: 'bg-blue-50 text-blue-800 ring-blue-200', purple: 'bg-violet-50 text-violet-800 ring-violet-200',
};
/** <Badge tone="gray|green|yellow|red|blue|purple">Text</Badge> — always carries text, never colour alone (Q8). */
export default function Badge({ tone = 'gray', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone] || TONES.gray} ${className}`}>{children}</span>;
}
