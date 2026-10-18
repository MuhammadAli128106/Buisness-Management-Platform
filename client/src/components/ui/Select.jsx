import { forwardRef } from 'react';
import { inputClass } from './Input';

/** <Select options={[{value,label}]} placeholder="Choose…" value onChange /> */
const Select = forwardRef(function Select({ options = [], placeholder, className = '', ...rest }, ref) {
  return (
    <select ref={ref} className={`${inputClass} ${className}`} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={String(o.value)} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
});
export default Select;
