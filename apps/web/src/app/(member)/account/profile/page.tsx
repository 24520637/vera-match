import { MemberSettings } from "@/components/member/member-settings";
export const metadata = { title: "Your profile", robots: { index: false } };
export default function ProfilePage() { return <MemberSettings screen="profile" />; }
