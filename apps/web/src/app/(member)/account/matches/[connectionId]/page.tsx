import type { Metadata } from "next";
import { MatchConnectionScreen } from "@/components/member/match-connection";
export const metadata: Metadata = {
  title: "Your mutual connection", robots: { index: false, follow: false }, referrer: "no-referrer",
};
export default async function ConnectionPage({ params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  return <MatchConnectionScreen connectionId={connectionId} />;
}
