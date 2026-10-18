import Modal from './Modal';
import Button from './Button';

/** <ConfirmDialog open title message confirmLabel="Delete" danger loading onConfirm onCancel>{extra content}</ConfirmDialog> */
export default function ConfirmDialog({ open, title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = true, loading, onConfirm, onCancel, children }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      {message && <p className="text-sm text-slate-600">{message}</p>}
      {children}
    </Modal>
  );
}
