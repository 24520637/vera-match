import type { Metadata } from "next";
import { MemberMatches } from "@/components/member/member-matches";

export const metadata: Metadata = {
  title: "Your matches",
  robots: { index: false },
};

export default function MatchesPage() {
  return <MemberMatches />;
}
