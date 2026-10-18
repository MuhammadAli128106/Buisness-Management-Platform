// Sidebar — owner: Musa. Items are filtered by permission KEYS (F1.3), never role names.
import { NavLink } from 'react-router-dom';
import { useCan } from '../hooks/useCan';

export const NAV = [
  { section: 'Work', items: [
    { to: '/dashboard', label: 'Dashboard', icon: '📊' },
    { to: '/leads', label: 'Leads', icon: '⚡' },
    { to: '/recovery', label: 'Recovery queue', icon: '🛟', perm: 'leads.reassign' },
    { to: '/inbox', label: 'Inbox', icon: '💬', perm: 'crm.view' },
  ] },
  { section: 'CRM', items: [
    { to: '/contacts', label: 'Contacts', icon: '👤', perm: 'crm.view' },
    { to: '/companies', label: 'Companies', icon: '🏢', perm: 'crm.view' },
    { to: '/opportunities', label: 'Opportunities', icon: '💼', perm: 'crm.view' },
    { to: '/pipeline', label: 'Pipeline board', icon: '🗂️', perm: 'crm.view' },
    { to: '/payments', label: 'Payments', icon: '💳', perm: 'crm.view' },
  ] },
  { section: 'Settings', items: [
    { to: '/settings/users', label: 'Users', icon: '👥', perm: 'users.manage' },
    { to: '/settings/roles', label: 'Roles & permissions', icon: '🔐', perm: 'users.manage' },
    { to: '/settings/pipelines', label: 'Pipelines', icon: '🧭', perm: 'pipeline.manage' },
    { to: '/settings/custom-fields', label: 'Custom fields', icon: '🧩', perm: 'pipeline.manage' },
    { to: '/settings/assignment-rules', label: 'Assignment rules', icon: '⏱️', perm: 'rules.manage' },
    { to: '/settings/integrations', label: 'Integrations', icon: '🔌', perm: 'integrations.manage' },
    { to: '/audit', label: 'Audit log', icon: '📜', perm: 'audit.view' },
  ] },
];

export default function Sidebar({ onNavigate }) {
  const can = useCan();
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.perm || can(i.perm));
        if (!items.length) return null;
        return (
          <div key={group.section}>
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.section}</p>
            <ul className="flex flex-col gap-0.5">
              {items.map((i) => (
                <li key={i.to}>
                  <NavLink to={i.to} onClick={onNavigate}
                    className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-primary text-white' : 'text-slate-300 hover:bg-navy-800 hover:text-white'}`}>
                    <span aria-hidden="true">{i.icon}</span>{i.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
