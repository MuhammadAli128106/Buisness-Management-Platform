// Public payment page /pay/:token — owner: Musa. Real Google Pay sheet in the TEST environment (I2).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, apiPost } from '../utils/api';
import { money, dateTime } from '../utils/format';
import { Spinner } from '../components/ui';

function loadGooglePay() {
  if (window.google?.payments?.api) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://pay.google.com/gp/p/js/pay.js'; s.async = true;
    s.onload = resolve; s.onerror = () => reject(new Error('Could not load Google Pay. Check your connection.'));
    document.head.appendChild(s);
  });
}

export default function PayPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const btnRef = useRef(null);

  const load = useCallback(async () => {
    try { setInfo((await apiGet(`/public/pay/${token}`)).data); } catch (e) { setError(e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!info || info.status !== 'pending' || !btnRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        await loadGooglePay();
        if (cancelled) return;
        const g = info.google_pay;
        const client = new window.google.payments.api.PaymentsClient({ environment: g.environment });
        const card = {
          type: 'CARD',
          parameters: { allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], allowedCardNetworks: ['MASTERCARD', 'VISA', 'AMEX'] },
          tokenizationSpecification: { type: 'PAYMENT_GATEWAY', parameters: { gateway: g.gateway, gatewayMerchantId: g.gateway_merchant_id } },
        };
        const base = { apiVersion: 2, apiVersionMinor: 0 };
        const ready = await client.isReadyToPay({ ...base, allowedPaymentMethods: [card] });
        if (!ready.result) { setError('Google Pay is not available in this browser. Try Chrome while signed in to a Google account.'); return; }
        const request = {
          ...base, allowedPaymentMethods: [card],
          merchantInfo: { merchantName: g.merchant_name },
          transactionInfo: { totalPriceStatus: 'FINAL', totalPrice: (info.amount_cents / 100).toFixed(2), currencyCode: info.currency, countryCode: g.country_code },
        };
        const button = client.createButton({
          buttonType: 'pay', buttonSizeMode: 'fill',
          onClick: async () => {
            setBusy(true); setError('');
            try {
              const paymentData = await client.loadPaymentData(request);
              const r = await apiPost(`/public/pay/${token}/complete`, { paymentData });
              setResult(r.data); await load();
            } catch (e) {
              if (e?.statusCode) { apiPost(`/public/pay/${token}/abandon`, { statusCode: e.statusCode }).catch(() => {}); if (e.statusCode !== 'CANCELED') setError(e.statusMessage || 'Google Pay reported an error.'); } else setError(e.message);
            } finally { setBusy(false); }
          },
        });
        btnRef.current.replaceChildren(button);
      } catch (e) { setError(e.message); }
    })();
    return () => { cancelled = true; };
  }, [info, token, load]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {!info && !error && <div className="flex justify-center py-10"><Spinner label="Loading payment" /></div>}
        {!info && error && <p role="alert" className="text-center text-slate-700">{error}</p>}
        {info && (
          <>
            <p className="text-sm text-slate-500">Payment to</p>
            <h1 className="text-xl font-semibold text-slate-900">{info.company}</h1>
            <p className="mt-4 text-sm text-slate-600">{info.customer_first_name ? `Hi ${info.customer_first_name}, ` : ''}{info.description}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{money(info.amount_cents, info.currency)}</p>
            {info.status === 'pending' && (
              <>
                <p className="mt-1 text-xs text-slate-500">Link expires {dateTime(info.expires_at)}</p>
                <div ref={btnRef} className="mt-6 h-12" aria-busy={busy} />
                {busy && <p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><Spinner size="sm" /> Confirming with Google Pay…</p>}
                <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Test environment — no real money is charged. Your card details go only to Google; this site never sees them.</p>
              </>
            )}
            {info.status === 'paid' && <p role="status" className="mt-6 rounded-lg bg-emerald-50 p-4 font-medium text-emerald-800">✓ Paid {info.paid_at ? dateTime(info.paid_at) : ''}. Reference {info.reference || result?.reference}. You can close this page.</p>}
            {info.status === 'expired' && <p role="alert" className="mt-6 rounded-lg bg-slate-100 p-4 text-slate-700">This payment link has expired. Please ask {info.company} for a new one.</p>}
            {['failed', 'refunded', 'partially_refunded'].includes(info.status) && <p className="mt-6 rounded-lg bg-slate-100 p-4 text-slate-700">This payment is {info.status.replace('_', ' ')}. Contact {info.company} if you have questions.</p>}
            {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}
