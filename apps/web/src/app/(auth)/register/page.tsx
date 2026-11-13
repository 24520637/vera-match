import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/server-session';
import { AuthScaffold } from '@/components/auth/auth-scaffold';
import { RegisterForm } from '@/components/auth/register-form';
export const metadata: Metadata = { title: 'Create an account', robots: { index: false }, referrer: 'no-referrer' };
export default async function RegisterPage() { if ((await getServerSession()).status === 'authenticated') redirect('/account'); return <AuthScaffold title="Start with you." description="A little space for your story. Create an account, then confirm your email to begin."><RegisterForm /></AuthScaffold>; }
