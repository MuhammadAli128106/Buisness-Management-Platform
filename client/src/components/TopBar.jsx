// TopBar — owner: Musa. Hosts Ali's <AvailabilityToggle/>.
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AvailabilityToggle from './AvailabilityToggle';

export default function TopBar({ onMenu }) {
  const { user, logout } = useAuth();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
      <button type="button" onClick={onMenu} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">☰</button>
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-600">{user?.workspace?.name}</p>
      <AvailabilityToggle />
      <Link to="/profile" className="hidden items-center gap-2 rounded-lg px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 sm:flex">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">{user?.name?.[0]?.toUpperCase()}</span>
        <span className="max-w-[10rem] truncate">{user?.name}</span>
        <span className="text-xs text-slate-400">({user?.level === 'owner' ? 'Owner' : user?.role_name || user?.level})</span>
      </Link>
      <button type="button" onClick={logout} className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">Log out</button>
    </header>
  );
}
