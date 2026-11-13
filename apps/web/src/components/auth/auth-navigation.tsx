'use client';
import Link from 'next/link';
import { useAuth } from './auth-provider';
export function AuthNavigation({ onNavigate }: { onNavigate: () => void }) {
  const { state } = useAuth();
  if (state.status === 'checking') return <span className="small muted" role="status">Checking session…</span>;
  if (state.status === 'unauthenticated') return <Link href="/login" onClick={onNavigate}>Sign in</Link>;
  return <Link href="/account" onClick={onNavigate}>{state.status === 'authenticated' ? 'Your account' : 'Check account access'}</Link>;
}
