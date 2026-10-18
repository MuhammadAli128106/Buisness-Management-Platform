// Public landing page — owner: Ali. Logged-in visitors go straight to the dashboard.
// Design: deep navy "control room", one memorable element — the live relay track in the hero.
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DISPLAY = "font-['Bricolage_Grotesque',system-ui,sans-serif]";
const BODY = "font-['Instrument_Sans',Inter,system-ui,sans-serif]";

const CHAIN = [
  { who: 'Sara Malik', role: 'Assigned first' },
  { who: 'Bilal Ahmed', role: 'Next available' },
  { who: 'Hina Raza', role: 'Sara’s backup' },
  { who: 'Maria Khan', role: 'Sales manager' },
];
const WINDOW = 20; // seconds each person gets in the demo
const ACK_AT = 9; // the manager picks it up with this many seconds left
const HOLD = 14; // ticks to show the "picked up" state before restarting

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    setReduced(mq.matches);
    const on = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** A lead passing down the escalation chain, played at 4x speed. */
function RelayTrack() {
  const reduced = useReducedMotion();
  const [s, setS] = useState({ step: 0, left: WINDOW, done: 0 });

  useEffect(() => {
    const t = setInterval(() => {
      setS(({ step, left, done }) => {
        if (done) return done >= HOLD ? { step: 0, left: WINDOW, done: 0 } : { step, left, done: done + 1 };
        if (step === CHAIN.length - 1 && left <= ACK_AT) return { step, left, done: 1 };
        if (left > 1) return { step, left: left - 1, done };
        return { step: step + 1, left: WINDOW, done };
      });
    }, reduced ? 500 : 250);
    return () => clearInterval(t);
  }, [reduced]);

  const { step, left, done } = s;
  const urgent = !done && left <= 6;
  const fill = ((step + (done ? 1 : (WINDOW - left) / WINDOW)) / CHAIN.length) * 100;

  return (
    <figure className="relative rounded-2xl border border-[#22344F] bg-[#0F1D31] p-5 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.8)] sm:p-7">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <p className={`${DISPLAY} text-xl font-bold text-[#EEF2F8]`}>Ahmed Khan wants a quote for a 10 kW system</p>
          <p className="mt-1 text-sm text-[#8C9BB4]">Came in from the website form. Watch who has it.</p>
        </div>
        <p
          className={`${DISPLAY} text-4xl font-extrabold tabular-nums transition-colors ${done ? 'text-[#4FD1B0]' : urgent ? 'text-[#FF8A6B]' : 'text-[#F5B841]'}`}
          aria-live="off"
        >
          {done ? 'Picked up' : `0:${String(left).padStart(2, '0')}`}
        </p>
      </figcaption>

      {/* the track */}
      <div className="relative mt-8 hidden sm:block" aria-hidden="true">
        <div className="absolute left-0 right-0 top-[9px] h-[3px] rounded-full bg-[#22344F]" />
        <div
          className={`absolute left-0 top-[9px] h-[3px] rounded-full ${done ? 'bg-[#4FD1B0]' : 'bg-[#F5B841]'} ${reduced ? '' : 'transition-[width] duration-300 ease-linear'}`}
          style={{ width: `${fill}%` }}
        />
      </div>

      <ol className="relative mt-6 grid sm:mt-0 grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
        {CHAIN.map((c, i) => {
          const active = i === step;
          const passed = i < step;
          const state = active ? (done ? 'Picked it up' : 'Has it now') : passed ? 'Didn’t respond in time' : 'Waiting';
          return (
            <li key={c.who} className="relative">
              <span
                className={`block h-[21px] w-[21px] rounded-full border-[3px] ${
                  active ? (done ? 'border-[#4FD1B0] bg-[#4FD1B0]' : 'border-[#F5B841] bg-[#0F1D31]') : passed ? 'border-[#3A4D6B] bg-[#3A4D6B]' : 'border-[#22344F] bg-[#0F1D31]'
                } ${active && !done && !reduced ? 'animate-pulse' : ''}`}
              />
              <p className={`mt-3 font-semibold ${active ? 'text-[#EEF2F8]' : passed ? 'text-[#6B7A93] line-through decoration-[#3A4D6B]' : 'text-[#8C9BB4]'}`}>{c.who}</p>
              <p className="text-sm text-[#6B7A93]">{c.role}</p>
              <p className={`mt-1 text-sm font-medium ${active ? (done ? 'text-[#4FD1B0]' : 'text-[#F5B841]') : 'text-[#56657E]'}`}>{state}</p>
            </li>
          );
        })}
      </ol>
      <p className="sr-only">Example: a lead goes to Sara, then Bilal, then Hina, then Maria, each getting a short timer, until Maria picks it up.</p>
    </figure>
  );
}

const STEPS = [
  ['A lead comes in', 'From your website form, a Telegram message, or someone typing it in.'],
  ['One person owns it', 'It goes to the next teammate who is available and not already full. Their timer starts.'],
  ['Ignored? It moves', 'Next person, then their backup, then their manager. Each gets a Telegram alert with a link.'],
  ['Nothing slips quietly', 'Stuck leads land in a recovery queue, and every hand-off is written to a log nobody can edit.'],
];

const ALSO = [
  ['Pipelines your way', 'Your own stages and fields, with fields that must be filled before a deal moves on.'],
  ['Telegram inbox', 'Customers message your bot; replies go out from the contact’s page.'],
  ['Payment links', 'Send a Google Pay link; the deal shows Paid as soon as the payment is verified.'],
  ['Calendar booking', 'Book site visits into each person’s Google Calendar, with clashes flagged first.'],
  ['Away means away', 'Mark someone on leave and their waiting leads move to a teammate at once.'],
  ['Each team sealed off', 'Every company’s data stays in its own workspace, and roles decide who sees deal values.'],
];

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F5B841]';

export default function Landing() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" replace />;

  return (
    <div className={`${BODY} relative min-h-screen overflow-x-hidden bg-[#0A1424] text-[#B7C3D6]`}>
      {/* faint grid, like a dispatch board */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[720px] opacity-[0.35] [background-image:linear-gradient(#16263D_1px,transparent_1px),linear-gradient(90deg,#16263D_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]"
      />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link to="/" className={`${DISPLAY} flex items-center gap-2 rounded-md text-xl font-extrabold tracking-tight text-[#EEF2F8] ${focus}`}>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <circle cx="11" cy="11" r="8.5" fill="none" stroke="#22344F" strokeWidth="3" />
            <path d="M11 2.5 A8.5 8.5 0 0 1 19.5 11" fill="none" stroke="#F5B841" strokeWidth="3" strokeLinecap="round" />
          </svg>
          LeadGuard
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link to="/login" className={`rounded-lg px-3 py-2 text-[#B7C3D6] hover:text-white ${focus}`}>Log in</Link>
          <Link to="/signup" className={`rounded-lg bg-[#EEF2F8] px-4 py-2 font-semibold text-[#0A1424] hover:bg-white ${focus}`}>Sign up</Link>
        </nav>
      </header>

      <main className="relative">
        <section className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6 md:pt-20">
          <h1 className={`${DISPLAY} max-w-4xl text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] text-[#EEF2F8] [text-wrap:balance] sm:text-6xl lg:text-[4.75rem]`}>
            No lead waits for someone who’s on leave.
          </h1>
          <div className="mt-7 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <p className="max-w-xl text-lg leading-relaxed text-[#9AA8BF]">
              LeadGuard is a CRM for small sales teams. Every new lead goes to one person who’s actually available, and if they don’t pick it up in time, it goes to the next one.
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-5">
              <Link to="/signup" className={`rounded-xl bg-[#F5B841] px-6 py-3 font-semibold text-[#0A1424] hover:bg-[#FFC95E] ${focus}`}>
                Set up your team
              </Link>
              <Link to="/login" className={`rounded text-sm text-[#B7C3D6] underline decoration-[#3A4D6B] underline-offset-4 hover:text-white hover:decoration-white ${focus}`}>
                I already have an account
              </Link>
            </div>
          </div>

          <div className="mt-14">
            <RelayTrack />
          </div>
        </section>

        <section className="border-t border-[#16263D] bg-[#0C182B]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className={`${DISPLAY} text-3xl font-bold tracking-tight text-[#EEF2F8]`}>What happens to a lead</h2>
            <ol className="mt-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
              {STEPS.map(([title, body], i) => (
                <li key={title} className="border-l-2 border-[#22344F] pl-5 first:border-[#F5B841]">
                  <span className={`${DISPLAY} text-5xl font-extrabold text-[#22344F]`}>{i + 1}</span>
                  <p className="mt-3 text-lg font-semibold text-[#EEF2F8]">{title}</p>
                  <p className="mt-2 leading-relaxed text-[#8C9BB4]">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
            <h2 className={`${DISPLAY} text-3xl font-bold tracking-tight text-[#EEF2F8] [text-wrap:balance]`}>
              And the rest of the CRM you’d expect
            </h2>
            <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {ALSO.map(([title, body]) => (
                <div key={title}>
                  <dt className="font-semibold text-[#EEF2F8]">{title}</dt>
                  <dd className="mt-1.5 leading-relaxed text-[#8C9BB4]">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-[#F5B841] px-6 py-10 text-[#0A1424] sm:flex-row sm:items-center sm:px-10">
            <p className={`${DISPLAY} max-w-xl text-3xl font-extrabold leading-tight tracking-tight`}>
              Give every lead an owner, starting today.
            </p>
            <Link to="/signup" className="shrink-0 rounded-xl bg-[#0A1424] px-6 py-3 font-semibold text-[#EEF2F8] hover:bg-[#13233A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A1424]">
              Set up your team
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl border-t border-[#16263D] px-4 py-8 text-sm text-[#6B7A93] sm:px-6">
        LeadGuard works with Telegram, Google Pay and Google Calendar.
      </footer>
    </div>
  );
}
