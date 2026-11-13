'use client';
import { useAuth } from './auth-provider';
import { PageHeader } from '../layout/page-layout';
import { Notice } from '../ui/status';
export function AccountOverview() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;
  return <div className="container"><PageHeader title={`Welcome${state.user.displayName ? `, ${state.user.displayName}` : ' to your account'}.`} description="Your session is active. You control what happens next." /><dl className="stack"><div><dt className="small muted">Email address</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{state.user.email}</dd></div><div><dt className="small muted">Account role</dt><dd style={{ margin: 0 }}>{state.user.role.toLowerCase()}</dd></div></dl><div className="section"><Notice title="Your account is ready.">Profile, private video review and matching tools are still in development.</Notice></div></div>;
}
