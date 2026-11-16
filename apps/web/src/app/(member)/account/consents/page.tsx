import { MemberSettings } from "@/components/member/member-settings";
// No policy is published by the approved runtime registry; grants remain unavailable.
export const metadata = { title: "Your consent choices", robots: { index: false } };
export default function ConsentsPage() { return <MemberSettings screen="consents" />; }
