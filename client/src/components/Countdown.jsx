// <Countdown secondsLeft={n} /> — owner: Ali. mm:ss to the acknowledgement deadline (F3.4).
// The server computes seconds_left (so browser clock drift doesn't matter); we tick locally between polls.
import { useEffect, useState } from 'react';

export default function Countdown({ secondsLeft, className = '' }) {
  const [base, setBase] = useState({ s: secondsLeft, at: Date.now() });
  const [, setTick] = useState(0);

  useEffect(() => { setBase({ s: secondsLeft, at: Date.now() }); }, [secondsLeft]);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (secondsLeft === null || secondsLeft === undefined) return <span className={`text-slate-400 ${className}`}>—</span>;

  const left = Math.round(base.s - (Date.now() - base.at) / 1000);
  if (left <= 0) {
    return <span className={`font-semibold text-red-700 ${className}`}>Overdue</span>;
  }
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  const urgent = left < 10;
  return (
    <span className={`font-mono tabular-nums ${urgent ? 'font-semibold text-red-700' : 'text-slate-700'} ${className}`}>
      {mm}:{ss}<span className="sr-only"> left to acknowledge</span>
    </span>
  );
}
