// Public enquiry form at /f/:slug — owner: Ali (F3.1). No login. POST /public/forms/:slug/lead
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';
import { apiGet, apiPost } from '../utils/api';
import { Button, Field, Input, Spinner, Textarea } from '../components/ui';

export default function PublicForm() {
  const { slug } = useParams();
  const { data, error } = useSWR(`/public/forms/${slug}`, apiGet, { shouldRetryOnError: false });
  const [f, setF] = useState({ name: '', phone: '', email: '', message: '', website: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setFormError('');
    try { await apiPost(`/public/forms/${slug}/lead`, f); setDone(true); } catch (err) { setErrors(err.details || {}); setFormError(err.details ? 'Please check the highlighted fields.' : err.message); } finally { setBusy(false); }
  };

  const company = data?.data?.workspace_name;

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-100 px-4 py-10 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        {error ? (
          <p className="text-center text-slate-600">This form doesn’t exist. Check the link you were given.</p>
        ) : !data ? (
          <div className="flex justify-center py-10"><Spinner label="Loading form" /></div>
        ) : done ? (
          <div className="py-6 text-center">
            <p className="text-3xl" aria-hidden="true">✓</p>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">Thanks, {f.name.split(' ')[0]}!</h1>
            <p className="mt-2 text-slate-600">Your enquiry is with {company}. A named person on their team now owns it and will contact you shortly.</p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-900">Contact {company}</h1>
            <p className="mt-1 text-sm text-slate-500">Leave your details and someone will get back to you quickly.</p>
            <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
              {formError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</p>}
              <Field label="Your name" required error={errors.name}><Input value={f.name} onChange={set('name')} autoComplete="name" /></Field>
              <Field label="Phone" error={errors.phone} hint="Phone or email — at least one"><Input value={f.phone} onChange={set('phone')} type="tel" autoComplete="tel" placeholder="+92 300 1234567" /></Field>
              <Field label="Email" error={errors.email}><Input value={f.email} onChange={set('email')} type="email" autoComplete="email" /></Field>
              <Field label="How can we help?" error={errors.message}><Textarea rows={4} value={f.message} onChange={set('message')} /></Field>
              {/* Honeypot: hidden from people, bots fill it in */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
                <label htmlFor="website">Website</label>
                <input id="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} />
              </div>
              <Button type="submit" loading={busy} className="w-full">Send enquiry</Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
