import { forwardRef } from 'react';
import { inputClass } from './Input';

const Textarea = forwardRef(function Textarea({ className = '', rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={`${inputClass} ${className}`} {...rest} />;
});
export default Textarea;
