/** <EmptyState title body action={<Button/>} icon="📭" /> */
export default function EmptyState({ title = 'Nothing here yet', body, action, icon = '📭' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <span aria-hidden="true" className="text-3xl">{icon}</span>
      <p className="font-medium text-slate-800">{title}</p>
      {body && <p className="max-w-sm text-sm text-slate-500">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
