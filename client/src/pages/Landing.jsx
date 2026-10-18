// Public landing page — owner: Ali. Logged-in visitors go straight to the dashboard.
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const CHAIN = [
  { who: 'Sara', role: 'Assigned' },
  { who: 'Bilal', role: 'Next available' },
  { who: 'Hina', role: 'Backup' },
  { who: 'Maria', role: 'Manager' },
];
const WINDOW = 20; // seconds per step in the demo card

/** A looping, self-running demo of the escalation chain. */
function EscalationDemo() {
  const [step, setStep] = useState(0);
  const [left, setLeft] = useState(WINDOW);

  useEffect(() => {
    const t = setInterval(() => {
      setLeft((s) => {
        if (s > 1) return s - 1;
        setStep((i) => (i + 1) % CHAIN.length);
        return WINDOW;
      });
    }, 250); // runs 4x real time so the whole chain is visible in a few seconds
    return () => clearInterval(t);
  }, []);

  const owner = CHAIN[step];
  const urgent = left <= 6;

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl backdrop-blur" aria-label="Example of a lead escalating">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">New lead · Web form</p>
          <p className="mt-1 text-lg font-semibold text-white">Ahmed Khan</p>
          <p className="text-sm text-slate-400">Quote for a 10 kW rooftop system</p>
        </div>
        <span
          className={`shrink-0 rounded-lg px-2.5 py-1 font-mono text-sm tabular-nums ${urgent ? 'bg-red-500/15 text-red-300' : 'bg-white/10 text-slate-200'}`}
          aria-live="off"
        >
          0:{String(left).padStart(2, '0')}
        </span>
      </div>

      <div className="mt-5 rounded-xl bg-navy-950/60 p-3">
        <p className="text-xs text-slate-400">Accountable right now</p>
        <p className="mt-0.5 flex items-center gap-2 font-medium text-white">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs">{owner.who[0]}</span>
          {owner.who} <span className="text-sm font-normal text-slate-400">· {owner.role}</span>
        </p>
      </div>

      <ol className="mt-4 flex items-center gap-1.5" aria-label="Escalation chain">
        {CHAIN.map((c, i) => (
          <li key={c.who} className="flex flex-1 flex-col gap-1.5">
            <span className={`h-1 rounded-full transition-colors duration-300 ${i < step ? 'bg-slate-500' : i === step ? 'bg-accent' : 'bg-white/10'}`} />
            <span className={`text-[11px] ${i === step ? 'text-slate-200' : 'text-slate-500'}`}>{c.role}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-slate-500">Not acknowledged in time? It moves on — automatically, and on the record.</p>
    </div>
  );
}

const FEATURES = [
  {
    title: 'One owner, always',
    body: 'Round-robin to whoever is available. Ignored leads escalate to the next person, a backup, then a manager.',
  },
  {
    title: 'Real conversations',
    body: 'Customers message you on Telegram, pay through Google Pay, and book onto real Google calendars — all on one record.',
  },
  {
    title: 'Nothing goes unseen',
    body: 'A recovery queue for stuck leads, a live dashboard, and an audit trail no one can edit.',
  },
];

export default function Landing() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-navy-950 text-slate-200">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(60%_60%_at_70%_0%,rgba(37,99,235,0.28),transparent)]" aria-hidden="true" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2 text-white">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">⚡</span>
          <span className="text-lg font-semibold">LeadGuard</span>
        </span>
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/login" className="rounded-lg px-3 py-2 text-slate-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Log in</Link>
          <Link to="/signup" className="rounded-lg bg-white px-3 py-2 font-medium text-navy-950 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Get started</Link>
        </nav>
      </header>

      <main className="relative">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-10 sm:px-6 md:grid-cols-[1.35fr_1fr] md:pt-20">
          <div>
            <p className="text-sm font-medium text-accent">For sales teams of 5 to 30</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
              <span className="lg:whitespace-nowrap">Every lead gets an owner.</span> Every single time.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-slate-400">
              LeadGuard assigns each new enquiry to someone who&apos;s available, starts the clock, and escalates it before a customer is left waiting.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className="rounded-xl bg-primary px-5 py-3 font-medium text-white shadow-lg shadow-primary/20 hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Create your workspace
              </Link>
              <Link to="/login" className="rounded-xl border border-white/15 px-5 py-3 font-medium text-white hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Log in
              </Link>
            </div>
          </div>
          <div className="flex justify-center md:justify-end">
            <EscalationDemo />
          </div>
        </section>

        <section className="border-t border-white/5">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div key={f.title}>
                <p className="font-mono text-sm text-slate-500">0{i + 1}</p>
                <h2 className="mt-2 text-lg font-semibold text-white">{f.title}</h2>
                <p className="mt-2 text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} LeadGuard</span>
          <span>Leads, conversations, payments and appointments — one record.</span>
        </div>
      </footer>
    </div>
  );
}
