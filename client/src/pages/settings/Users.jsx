// Users settings — owner: Musa. ALSO THE REFERENCE PAGE for Ahmed's pages: SWR for reads, api helpers for writes,
// toasts with the server's error text, useCan() for buttons, every input in <Field>, DataTable for lists.
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useCan } from '../../hooks/useCan';
import { STATUS_LABELS } from '../../utils/format';
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select } from '../../components/ui';

const STATUS_TONE = { available: 'green', busy: 'yellow', on_leave: 'purple', offline: 'gray' };

export default function Users() {
  const { user: me } = useAuth();
  const can = useCan();
  const { data, error, isLoading, mutate } = useSWR('/users', apiGet);
  const { data: rolesRes } = useSWR('/roles', apiGet);
  const users = data?.data || [];
  const roles = rolesRes?.data || [];
  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }));
  const userOptions = (exceptId) => users.filter((u) => u.id !== exceptId).map((u) => ({ value: u.id, label: u.name }));

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '', level: 'user', role_id: '' });
  const [inviteErrors, setInviteErrors] = useState({});
  const [tempPw, setTempPw] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const submitInvite = async (e) => {
    e.preventDefault();
    setBusy(true); setInviteErrors({});
    try {
      const res = await apiPost('/users/invite', invite);
      setTempPw({ email: res.data.email, password: res.temp_password });
      setInviteOpen(false); setInvite({ name: '', email: '', level: 'user', role_id: '' });
      toast.success(`${res.data.name} added`);
      mutate();
    } catch (err) { setInviteErrors(err.details || {}); toast.error(err.message); } finally { setBusy(false); }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { id, name, level, role_id, backup_user_id, manager_user_id, status, original } = editing;
      const body = { name, role_id: role_id || null, backup_user_id: backup_user_id || null, manager_user_id: manager_user_id || null };
      if (original.level !== 'owner' && level !== original.level) body.level = level;
      await apiPatch(`/users/${id}`, body);
      if (status !== original.status) await apiPatch(`/users/${id}/status`, { status }); // Ali's endpoint (F3.6)
      toast.success('User updated');
      setEditing(null); mutate();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const deactivate = async (u) => {
    if (!window.confirm(`Deactivate ${u.name}? Their unacknowledged leads will be reassigned.`)) return;
    try { await apiPatch(`/users/${u.id}`, { is_active: false }); toast.success(`${u.name} deactivated`); mutate(); } catch (err) { toast.error(err.message); }
  };

  const columns = [
    { key: 'name', label: 'Name', render: (u) => <div><p className="font-medium text-slate-900">{u.name}{u.id === me.id && <span className="text-slate-400"> (you)</span>}</p><p className="text-xs text-slate-500">{u.email}</p></div> },
    { key: 'level', label: 'Level', render: (u) => <Badge tone={u.level === 'owner' ? 'blue' : u.level === 'admin' ? 'purple' : 'gray'}>{u.level === 'owner' ? 'Owner' : u.level === 'admin' ? 'Admin' : 'User'}</Badge> },
    { key: 'role_name', label: 'Role', render: (u) => u.role_name || '—' },
    { key: 'status', label: 'Status', render: (u) => <Badge tone={STATUS_TONE[u.status]}>{STATUS_LABELS[u.status]}</Badge> },
    { key: 'open_leads', label: 'Open leads' },
    { key: 'calendar_status', label: 'Calendar', render: (u) => <Badge tone={u.calendar_status === 'ok' ? 'green' : u.calendar_status === 'needs_reconnect' ? 'red' : 'gray'}>{u.calendar_status === 'ok' ? 'Connected' : u.calendar_status === 'needs_reconnect' ? 'Reconnect needed' : 'Not connected'}</Badge> },
    { key: 'telegram_connected', label: 'Telegram', render: (u) => (u.telegram_connected ? 'Linked' : 'Not linked') },
    {
      key: 'actions', label: <span className="sr-only">Actions</span>, render: (u) => (
        can('users.manage') && !(u.level === 'owner' && me.level !== 'owner') ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setEditing({ ...u, original: u }); }}>Edit</Button>
            {u.level !== 'owner' && u.id !== me.id && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); deactivate(u); }}>Deactivate</Button>}
          </div>
        ) : null
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Users" subtitle="Who works in this workspace, their level, role and availability."
        actions={can('users.manage') && <Button onClick={() => setInviteOpen(true)}>+ Invite user</Button>} />

      <DataTable columns={columns} rows={users} loading={isLoading} error={error} empty="No users yet" />

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a user"
        footer={<><Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button><Button type="submit" form="invite-form" loading={busy}>Create user</Button></>}>
        <form id="invite-form" onSubmit={submitInvite} className="flex flex-col gap-3">
          <Field label="Full name" required error={inviteErrors.name}><Input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></Field>
          <Field label="Email" required error={inviteErrors.email}><Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
          <Field label="Level" hint="Only the Owner can create Admin-level users">
            <Select value={invite.level} onChange={(e) => setInvite({ ...invite, level: e.target.value })}
              options={[{ value: 'user', label: 'User' }, { value: 'admin', label: 'Admin', disabled: me.level !== 'owner' }]} />
          </Field>
          <Field label="Role (permissions)" required error={inviteErrors.role_id}>
            <Select placeholder="Choose a role…" value={invite.role_id} onChange={(e) => setInvite({ ...invite, role_id: e.target.value })} options={roleOptions} />
          </Field>
        </form>
      </Modal>

      <Modal open={Boolean(tempPw)} onClose={() => setTempPw(null)} title="User created" size="sm" footer={<Button onClick={() => setTempPw(null)}>Done</Button>}>
        <p className="text-sm text-slate-600">Share these login details privately. The password is shown only once.</p>
        <dl className="mt-3 rounded-lg bg-slate-50 p-3 font-mono text-sm">
          <dt className="text-slate-500">Email</dt><dd className="mb-2 break-all">{tempPw?.email}</dd>
          <dt className="text-slate-500">Temporary password</dt><dd className="break-all">{tempPw?.password}</dd>
        </dl>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Edit ${editing?.name || ''}`}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="edit-user" loading={busy}>Save</Button></>}>
        {editing && (
          <form id="edit-user" onSubmit={saveEdit} className="flex flex-col gap-3">
            <Field label="Name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            {editing.level !== 'owner' && (
              <Field label="Level"><Select value={editing.level} onChange={(e) => setEditing({ ...editing, level: e.target.value })}
                options={[{ value: 'user', label: 'User' }, { value: 'admin', label: 'Admin', disabled: me.level !== 'owner' }]} /></Field>
            )}
            <Field label="Role"><Select placeholder="No role" value={editing.role_id || ''} onChange={(e) => setEditing({ ...editing, role_id: e.target.value })} options={roleOptions} /></Field>
            <Field label="Availability status" hint="On leave / Offline immediately reassigns their unacknowledged leads">
              <Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Backup (escalation level 2)"><Select placeholder="None" value={editing.backup_user_id || ''} onChange={(e) => setEditing({ ...editing, backup_user_id: e.target.value })} options={userOptions(editing.id)} /></Field>
            <Field label="Manager (escalation level 3)"><Select placeholder="None" value={editing.manager_user_id || ''} onChange={(e) => setEditing({ ...editing, manager_user_id: e.target.value })} options={userOptions(editing.id)} /></Field>
          </form>
        )}
      </Modal>
    </div>
  );
}
