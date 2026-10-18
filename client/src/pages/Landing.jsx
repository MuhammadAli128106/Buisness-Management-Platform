// Public landing page — owner: Ali. Logged-in visitors go straight to the dashboard.
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const CHAIN = [
  { who: 'Sara Malik', role: 'assigned' },
  { who: 'Bilal Ahmed', role: 'next available' },
  { who: 'Hina Raza', role: 'Sara’s backup' },
  { who: 'Maria Khan', role: 'manager' },
];
const WINDOW = 20; // seconds per person in the demo

/** Loops through the escalation chain at 4x speed so the whole thing plays in ~20 s. */
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
    }, 250);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="w-full max-w-sm rounded-lg border border-navy-700 bg-navy-900 text-sm" aria-label="Example: a lead moving between people">
      <div className="flex items-center justify-between border-b border-navy-700 px-4 py-3">
        <div>
          <p className="font-medium text-white">Ahmed Khan</p>
          <p className="text-slate-400">Web form · “Quote for a 10 kW system”</p>
        </div>
        <span className={`font-mono tabular-nums ${left <= 6 ? 'text-red-400' : 'text-slate-300'}`}>
          0:{String(left).padStart(2, '0')}
        </span>
      </div>
      <ol className="px-4 py-3">
        {CHAIN.map((c, i) => (
          <li key={c.who} className="flex items-center justify-between py-1.5">
            <span className={i === step ? 'text-white' : i < step ? 'text-slate-500 line-through decoration-slate-600' : 'text-slate-500'}>
              {c.who}
            </span>
            <span className={`text-xs ${i === step ? 'text-accent' : 'text-slate-500'}`}>
              {i === step ? `${c.role} · has it now` : c.role}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const STEPS = [
  ['A lead comes in', 'From your website form, a Telegram message, or someone typing it in.'],
  ['Someone owns it', 'It goes to the next person who is marked available and isn’t already full. They get a timer.'],
  ['If they don’t respond', 'It moves to the next person, then their backup, then their manager. Each of them gets a Telegram alert.'],
  ['You can see all of it', 'Stuck leads, response times and who did what are on the dashboard and in a log nobody can edit.'],
];

export default function Landing() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-navy-950 text-slate-300">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="text-lg font-semibold tracking-tight text-white">LeadGuard</span>
        <nav className="flex items-center gap-1 text-sm">
          <Link to="/login" className="rounded-md px-3 py-2 text-slate-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Log in</Link>
          <Link to="/signup" className="rounded-md bg-white px-3 py-2 font-medium text-navy-950 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Sign up</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-5xl items-center gap-12 px-4 pb-20 pt-10 sm:px-6 md:grid-cols-[1.25fr_1fr] md:pt-16">
          <div>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white [text-wrap:balance] sm:text-5xl">
              No lead waits for someone who’s on leave.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-slate-400">
              LeadGuard is a CRM for small sales teams. Every new lead goes to one person who’s actually available, and if they don’t pick it up in time, it goes to someone else.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link to="/signup" className="rounded-md bg-primary px-5 py-2.5 font-medium text-white hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Set up your team
              </Link>
              <Link to="/login" className="text-sm text-slate-300 underline underline-offset-4 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                I already have an account
              </Link>
            </div>
          </div>
          <div className="flex justify-center md:justify-end">
            <EscalationDemo />
          </div>
        </section>

        <section className="border-t border-navy-800">
          <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
            <h2 className="text-sm font-medium text-slate-400">What happens to a lead</h2>
            <ol className="mt-6 divide-y divide-navy-800 border-y border-navy-800">
              {STEPS.map(([title, body]) => (
                <li key={title} className="grid gap-1 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
                  <span className="font-medium text-white">{title}</span>
                  <span className="text-slate-400">{body}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-8 text-sm text-slate-500 sm:px-6">
        LeadGuard · Telegram, Google Pay and Google Calendar connected
      </footer>
    </div>
  );
}
