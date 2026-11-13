import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getServerSession } from '@/lib/server-session';
import { SessionBoundary, SessionUnavailable } from '@/components/auth/session-boundary';

export default async function MemberLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (session.status === 'unauthenticated') redirect('/login?next=%2Faccount');
  if (session.status !== 'authenticated') return <SessionUnavailable server denied={session.status === 'forbidden'} />;
  return <SessionBoundary>{children}</SessionBoundary>;
}
