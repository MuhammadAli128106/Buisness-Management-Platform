import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** <Modal open onClose title footer={<Buttons/>} size="md|lg">…</Modal> — Esc closes, focus moves inside (Q8). */
export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null);
  // Keep the latest onClose without re-running the effect: parents pass a new arrow function on every
  // render, which used to re-focus the first control (the ✕ button) after each keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => {
      const body = ref.current;
      (body?.querySelector('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])')
        || body?.querySelector('button'))?.focus();
    }, 0);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  const w = size === 'lg' ? 'max-w-2xl' : size === 'sm' ? 'max-w-sm' : 'max-w-lg';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[92vh] w-full ${w} flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close dialog">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
