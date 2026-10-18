// Layout — owner: Musa. Mounts Ali's <LeadAlerts/> once for every logged-in page.
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import LeadAlerts from './LeadAlerts';

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-navy-800 px-5">
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">⚡</span>
      <span className="text-base font-semibold text-white">LeadGuard</span>
    </div>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-navy-900 lg:flex"><Brand /><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-navy-900"><Brand /><Sidebar onNavigate={() => setOpen(false)} /></aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <TopBar onMenu={() => setOpen(true)} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6"><Outlet /></main>
      </div>
      <LeadAlerts />
    </div>
  );
}
