import type { Metadata } from 'next';
import { AuthScaffold } from '@/components/auth/auth-scaffold';
import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';
export const metadata: Metadata = { title: 'Verify your email', robots: { index: false }, referrer: 'no-referrer' };
export default function VerifyPage() { return <AuthScaffold title="One considered step." description="Confirm your email address to activate your account. This confirms access to your inbox, not your identity."><VerifyEmailPanel /></AuthScaffold>; }
