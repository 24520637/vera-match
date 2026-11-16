import type { Metadata } from "next";
import { AccountOverview } from "@/components/auth/account-overview";
import { MemberSettingsNav } from "@/components/member/member-settings";
export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false },
};
export default function AccountPage() {
  return <><AccountOverview /><MemberSettingsNav /></>;
}
