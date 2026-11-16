import { MemberSettings } from "@/components/member/member-settings";
export const metadata = { title: "Your preferences", robots: { index: false } };
export default function PreferencesPage() { return <MemberSettings screen="preferences" />; }
