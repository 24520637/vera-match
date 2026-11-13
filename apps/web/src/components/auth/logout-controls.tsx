'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, postAuth } from '@/lib/api';
import { Button } from '../ui/button';
import { FormActions } from '../ui/form';
import { Modal } from '../ui/modal';
import { Notice } from '../ui/status';
import { useAuth } from './auth-provider';
export function LogoutControls() {
  const { clearUser } = useAuth(); const router = useRouter(); const safeAction = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState(false); const [pending, setPending] = useState<'current' | 'all' | null>(null); const [error, setError] = useState('');
  async function logout(all: boolean) {
    if (pending) return; setPending(all ? 'all' : 'current'); setError('');
    try { await postAuth<void>(all ? 'logout-all' : 'logout', {}); clearUser(); router.replace('/login'); router.refresh(); }
    catch (failure) { if (failure instanceof ApiError && failure.status === 401) { clearUser(); router.replace('/login'); router.refresh(); } else setError(failure instanceof ApiError ? failure.message : 'Sign-out could not be confirmed. Try again.'); }
    finally { setPending(null); }
  }
  return <div className="stack">{error && <Notice tone="error" title="Sign-out could not be confirmed.">{error}</Notice>}<FormActions><Button variant="secondary" loading={pending === 'current'} loadingLabel="Signing out…" disabled={!!pending} onClick={() => void logout(false)}>Sign out</Button><Button variant="quiet" disabled={!!pending} onClick={() => setConfirm(true)}>Sign out on all devices</Button></FormActions><Modal open={confirm} onOpenChange={setConfirm} dismissible={!pending} initialFocusRef={safeAction} title="Sign out everywhere?" description="This revokes active sessions for your account on all devices. You will need to sign in again."><div className="stack">{error && <Notice tone="error" title="Sign-out could not be confirmed.">{error}</Notice>}<FormActions><Button ref={safeAction} variant="secondary" disabled={!!pending} onClick={() => setConfirm(false)}>Keep me signed in</Button><Button variant="danger" loading={pending === 'all'} loadingLabel="Signing out…" onClick={() => void logout(true)}>Sign out everywhere</Button></FormActions></div></Modal></div>;
}
