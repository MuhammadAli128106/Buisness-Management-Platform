// Public landing page — owner: Ali. Logged-in visitors go straight to the dashboard.
// Palette: warm black, ivory, champagne gold. Headings in Cormorant Garamond (loaded below).
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const C = {
  bg: '#0d0c0a',
  surface: '#15130f',
  line: 'rgba(232,220,196,0.10)',
  ivory: '#f2ece0',
  muted: '#a39e93',
  dim: '#8a857a',
  gold: '#c9a96e',
  goldHover: '#d9bd86',
  rust: '#c97a62',
};
const SERIF = { fontFamily: '"Cormorant Garamond", "Times New Roman", serif' };
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&display=swap';

function useSerifFont() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);
}

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
    }, 250); // 4x real time so the whole chain plays in a few seconds
    return () => clearInterval(t);
  }, []);

  const owner = CHAIN[step];
  const urgent = left <= 6;

  return (
    <div
      className="w-full max-w-sm rounded-lg border p-6"
      style={{ background: C.surface, borderColor: C.line }}
      aria-label="Example of a lead escalating"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: C.dim }}>New lead · Web form</p>
          <p className="mt-2 text-2xl" style={{ ...SERIF, color: C.ivory }}>Ahmed Khan</p>
          <p className="mt-0.5 text-sm" style={{ color: C.muted }}>Quote for a 10 kW rooftop system</p>
        </div>
        <span
          className="shrink-0 rounded border px-2 py-0.5 font-mono text-sm tabular-nums transition-colors"
          style={{ borderColor: urgent ? C.rust : C.line, color: urgent ? C.rust : C.ivory }}
        >
          0:{String(left).padStart(2, '0')}
        </span>
      </div>

      <div className="mt-6 border-t pt-4" style={{ borderColor: C.line }}>
        <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: C.dim }}>Accountable now</p>
        <p className="mt-2 flex items-center gap-2.5" style={{ color: C.ivory }}>
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full border text-xs"
            style={{ borderColor: C.gold, color: C.gold }}
          >
            {owner.who[0]}
          </span>
          {owner.who} <span className="text-sm" style={{ color: C.muted }}>· {owner.role}</span>
        </p>
      </div>

      <ol className="mt-5 flex items-center gap-1.5" aria-label="Escalation chain">
        {CHAIN.map((c, i) => (
          <li key={c.who} className="flex flex-1 flex-col gap-2">
            <span
              className="h-px transition-colors duration-300"
              style={{ background: i === step ? C.gold : i < step ? C.muted : C.line, height: i === step ? 2 : 1 }}
            />
            <span className="text-[11px]" style={{ color: i === step ? C.ivory : C.dim }}>{c.role}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-xs leading-relaxed" style={{ color: C.dim }}>
        Not acknowledged in time? It moves on — automatically, and on the record.
      </p>
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

const focusRing = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-[#c9a96e]';

export default function Landing() {
  useSerifFont();
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="relative min-h-screen overflow-x-hidden" style={{ background: C.bg, color: C.muted }}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{ background: 'radial-gradient(50% 55% at 75% 0%, rgba(201,169,110,0.10), transparent)' }}
        aria-hidden="true"
      />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <span className="flex items-center gap-3" style={{ color: C.ivory }}>
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-sm border text-lg leading-none"
            style={{ ...SERIF, borderColor: C.gold, color: C.gold }}
          >
            L
          </span>
          <span className="text-sm uppercase tracking-[0.28em]">LeadGuard</span>
        </span>
        <nav className="flex items-center gap-1 text-sm sm:gap-3">
          <Link to="/login" className={`px-3 py-2 transition-colors hover:text-[#f2ece0] ${focusRing}`} style={{ color: C.muted }}>
            Log in
          </Link>
          <Link
            to="/signup"
            className={`rounded-sm border px-4 py-2 transition-colors hover:bg-[#c9a96e] hover:text-[#0d0c0a] ${focusRing}`}
            style={{ borderColor: C.gold, color: C.gold }}
          >
            Get started
          </Link>
        </nav>
      </header>

      <main className="relative">
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-24 pt-12 sm:px-8 md:grid-cols-[1.35fr_1fr] md:pt-24">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em]" style={{ color: C.gold }}>For sales teams of 5 to 30</p>
            <h1
              className="mt-5 text-5xl leading-[1.05] sm:text-6xl lg:text-7xl"
              style={{ ...SERIF, color: C.ivory, fontWeight: 500 }}
            >
              Every lead gets an owner.
              <span className="block italic" style={{ color: C.gold }}>Every single time.</span>
            </h1>
            <p className="mt-7 max-w-md text-base leading-relaxed sm:text-lg">
              LeadGuard assigns each new enquiry to someone who&apos;s available, starts the clock, and escalates it before a customer is left waiting.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-6">
              <Link
                to="/signup"
                className={`rounded-sm px-6 py-3 text-sm font-medium tracking-wide transition-colors hover:bg-[#d9bd86] ${focusRing}`}
                style={{ background: C.gold, color: C.bg }}
              >
                Create your workspace
              </Link>
              <Link
                to="/login"
                className={`border-b pb-0.5 text-sm tracking-wide transition-colors hover:text-[#f2ece0] ${focusRing}`}
                style={{ borderColor: C.line, color: C.ivory }}
              >
                Log in →
              </Link>
            </div>
          </div>
          <div className="flex justify-center md:justify-end">
            <EscalationDemo />
          </div>
        </section>

        <section className="border-t" style={{ borderColor: C.line }}>
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div key={f.title}>
                <p className="text-sm" style={{ ...SERIF, color: C.gold }}>{['I', 'II', 'III'][i]}</p>
                <h2 className="mt-3 text-2xl" style={{ ...SERIF, color: C.ivory, fontWeight: 500 }}>{f.title}</h2>
                <p className="mt-3 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: C.line }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-7 text-xs tracking-wide sm:flex-row sm:justify-between sm:px-8" style={{ color: C.dim }}>
          <span>© {new Date().getFullYear()} LeadGuard</span>
          <span>Leads, conversations, payments and appointments — one record.</span>
        </div>
      </footer>
    </div>
  );
}
