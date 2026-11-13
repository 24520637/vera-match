import type { Metadata } from 'next';
import { AuthScaffold } from '@/components/auth/auth-scaffold';
import { ResendForm } from '@/components/auth/resend-form';
export const metadata: Metadata = { title: 'Resend activation email', robots: { index: false }, referrer: 'no-referrer' };
export default function ResendPage() { return <AuthScaffold title="A fresh start, in your inbox." description="Request a new activation link. Only the newest valid link can activate your account."><ResendForm /></AuthScaffold>; }
