import { cloneElement, isValidElement, useId } from 'react';

/** <Field label="Email" error={err} hint="..." required><Input .../></Field> — wires label/aria automatically (Q8). */
export default function Field({ label, error, hint, required, children, className = '' }) {
  const id = useId();
  const child = isValidElement(children)
    ? cloneElement(children, {
      id: children.props.id || id,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined,
      required: children.props.required ?? required,
    })
    : children;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label htmlFor={children?.props?.id || id} className="text-sm font-medium text-slate-700">
          {label}{required && <span className="text-red-600" aria-hidden="true"> *</span>}
        </label>
      )}
      {child}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-slate-500">{hint}</p>}
      {error && <p id={`${id}-err`} className="text-xs font-medium text-red-700">⚠ {error}</p>}
    </div>
  );
}
