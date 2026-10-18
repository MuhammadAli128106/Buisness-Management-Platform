// Roles & permissions — owner: Musa (F1.3). Permissions are data; Manager is just a role.
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost } from '../../utils/api';
import { Badge, Button, Checkbox, Field, Input, Modal, PageHeader, Spinner } from '../../components/ui';

export default function Roles() {
  const { data, isLoading, mutate } = useSWR('/roles', apiGet);
  const roles = data?.data || [];
  const perms = data?.permissions || [];
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const current = (r) => drafts[r.id] ?? r.permissions;
  const toggle = (r, key) => {
    const set = new Set(current(r));
    if (set.has(key)) set.delete(key); else set.add(key);
    setDrafts({ ...drafts, [r.id]: [...set] });
  };
  const save = async (r) => {
    setSaving(r.id);
    try {
      await apiPatch(`/roles/${r.id}`, { permissions: current(r) });
      toast.success(`${r.name} permissions saved — applies immediately`);
      setDrafts(({ [r.id]: _, ...rest }) => rest);
      mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(null); }
  };
  const create = async (e) => {
    e.preventDefault();
    try { await apiPost('/roles', { name: newName, permissions: [] }); toast.success('Role created'); setNewOpen(false); setNewName(''); mutate(); } catch (err) { toast.error(err.message); }
  };

  if (isLoading) return <div className="flex justify-center p-10"><Spinner /></div>;
  return (
    <div>
      <PageHeader title="Roles & permissions" subtitle="The Owner always has every permission. Everyone else gets exactly what their role grants — enforced on the server."
        actions={<Button onClick={() => setNewOpen(true)}>+ New role</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((r) => (
          <section key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-slate-900">{r.name}</h2>
              <Badge>{r.user_count} user{r.user_count === 1 ? '' : 's'}</Badge>
            </div>
            <fieldset>
              <legend className="sr-only">Permissions for {r.name}</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {perms.map((p) => <Checkbox key={p.key} label={p.label} checked={current(r).includes(p.key)} onChange={() => toggle(r, p.key)} />)}
              </div>
            </fieldset>
            <div className="mt-3 flex justify-end">
              <Button size="sm" disabled={!drafts[r.id]} loading={saving === r.id} onClick={() => save(r)}>Save {r.name}</Button>
            </div>
          </section>
        ))}
      </div>
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New role" size="sm"
        footer={<><Button variant="secondary" onClick={() => setNewOpen(false)}>Cancel</Button><Button type="submit" form="new-role">Create</Button></>}>
        <form id="new-role" onSubmit={create}><Field label="Role name" required><Input value={newName} onChange={(e) => setNewName(e.target.value)} /></Field></form>
      </Modal>
    </div>
  );
}
