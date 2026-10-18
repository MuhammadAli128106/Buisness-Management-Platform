import { useId } from 'react';

/** <Checkbox label="Opted out" checked onChange /> — label included, no <Field> needed. */
export default function Checkbox({ label, className = '', id, ...rest }) {
  const auto = useId();
  const cid = id || auto;
  return (
    <label htmlFor={cid} className={`inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 ${className}`}>
      <input id={cid} type="checkbox" className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary" {...rest} />
      <span>{label}</span>
    </label>
  );
}
