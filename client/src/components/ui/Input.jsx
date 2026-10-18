import { forwardRef } from 'react';

export const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-slate-100 aria-[invalid=true]:border-red-500';

/** <Input value onChange type placeholder /> — always wrap in <Field label>. */
const Input = forwardRef(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`${inputClass} ${className}`} {...rest} />;
});
export default Input;
