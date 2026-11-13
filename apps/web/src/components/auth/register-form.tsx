'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { postAuth } from '@/lib/api';
import { authErrorMessage, authFieldErrors } from '@/lib/auth-form';
import { Button, ButtonLink } from '../ui/button';
import { Checkbox, ErrorSummary, Form, FormActions, Input, focusFirstError } from '../ui/form';
import { Notice } from '../ui/status';
import { PasswordInput } from './password-input';
export function RegisterForm() {
  const [pending, setPending] = useState(false); const [complete, setComplete] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [message, setMessage] = useState('');
  const success = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (complete) success.current?.focus(); }, [complete]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return; const form = event.currentTarget; const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim(); const password = String(data.get('password') ?? ''); const displayName = String(data.get('displayName') ?? '').trim(); const declaredAdult = data.get('declaredAdult') === 'on'; const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) next['register-email'] = 'Enter an email address you can open.';
    if (Array.from(password).length < 12 || Array.from(password).length > 128) next['register-password'] = 'Use between 12 and 128 characters.';
    if (String(data.get('confirmation') ?? '') !== password) next['register-confirmation'] = 'Enter the same password again.';
    if (!declaredAdult) next['register-declaredAdult'] = 'You must declare that you are 18 or older.';
    if (displayName.length > 80) next['register-displayName'] = 'Use 80 characters or fewer.';
    setErrors(next); setMessage(''); if (Object.keys(next).length) { focusFirstError(form); return; }
    setPending(true);
    try { await postAuth('register', { email, password, declaredAdult, ...(displayName ? { displayName } : {}) }); setComplete(true); }
    catch (error) { setErrors(authFieldErrors(error, 'register', ['email', 'password', 'displayName', 'declaredAdult'])); setMessage(authErrorMessage(error)); focusFirstError(form); }
    finally { setPending(false); }
  }
  if (complete) return <div className="stack"><h2 ref={success} tabIndex={-1} className="auth-form-title">Check your inbox.</h2><Notice tone="success" title="Registration request received.">If this address is eligible, an activation email will arrive. Open the link to activate your account before signing in.</Notice><p className="small muted">Already registered or missing the email? Request another activation email. This does not sign you in.</p><div className="inline"><ButtonLink href="/login">Sign in</ButtonLink><ButtonLink href="/resend-verification" variant="quiet">Request another email</ButtonLink></div></div>;
  return <div className="stack"><h2 className="auth-form-title">Create an account</h2><Form noValidate onSubmit={submit} aria-label="Create account"><ErrorSummary errors={Object.entries(errors).map(([id, message]) => ({ id, message }))} />
    <Input id="register-displayName" name="displayName" label="Display name (optional)" autoComplete="nickname" maxLength={80} disabled={pending} error={errors['register-displayName']} />
    <Input id="register-email" name="email" label="Email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required disabled={pending} error={errors['register-email']} />
    <PasswordInput id="register-password" name="password" label="Password" autoComplete="new-password" hint="12–128 characters. Long, unique passwords are welcome." required disabled={pending} error={errors['register-password']} />
    <PasswordInput id="register-confirmation" name="confirmation" label="Confirm password" autoComplete="new-password" required disabled={pending} error={errors['register-confirmation']} />
    <Checkbox id="register-declaredAdult" name="declaredAdult" label="I declare that I am 18 or older" required disabled={pending} hint="This is your declaration; it does not verify your age or identity." error={errors['register-declaredAdult']} />
    {message && <Notice tone="error" title="Registration could not be completed.">{message}</Notice>}<FormActions><Button type="submit" loading={pending} loadingLabel="Creating account…">Create account</Button></FormActions>
  </Form><p className="small">Already registered?{' '}<Link href="/login">Sign in</Link></p></div>;
}
