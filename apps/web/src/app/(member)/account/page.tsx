import type { Metadata } from 'next';
import { AccountOverview } from '@/components/auth/account-overview';
export const metadata: Metadata = { title: 'Your account', robots: { index: false } };
export default function AccountPage() { return <AccountOverview />; }
