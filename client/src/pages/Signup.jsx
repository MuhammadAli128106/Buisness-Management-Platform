import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input } from '../components/ui';
import { AuthShell } from './Login';

export default function Signup() {
  const { user, signup } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ companyName: '', name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setError('');
    try {
      await signup(form);
      toast.success('Workspace created — you are the Owner');
      nav('/dashboard', { replace: true });
    } catch (err) { setError(err.message); setErrors(err.details || {}); } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Create your workspace" subtitle="You'll be the Owner. Invite your team after."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-white underline">Log in</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <Field label="Company name" required error={errors.companyName}><Input value={form.companyName} onChange={set('companyName')} autoComplete="organization" /></Field>
        <Field label="Your name" required error={errors.name}><Input value={form.name} onChange={set('name')} autoComplete="name" /></Field>
        <Field label="Work email" required error={errors.email}><Input type="email" value={form.email} onChange={set('email')} autoComplete="email" /></Field>
        <Field label="Password" required error={errors.password} hint="At least 8 characters"><Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" /></Field>
        <Button type="submit" loading={busy} className="w-full">Create workspace</Button>
      </form>
    </AuthShell>
  );
}
