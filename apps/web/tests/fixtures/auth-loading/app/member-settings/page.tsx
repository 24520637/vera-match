"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthProvider } from "../../../../../src/components/auth/auth-provider";
import { MemberSettings } from "../../../../../src/components/member/member-settings";
import { MemberDrafts } from "../../../../../src/components/member/member-drafts";
import { SessionBoundary } from "../../../../../src/components/auth/session-boundary";
import { PublishedPolicies, purposes, Screen } from "../../../../../src/lib/member-contracts";

/** Test-only presentation host using the real session provider and member components. */
function Fixture() {
  const query = useSearchParams();
  const value = query.get("screen") ?? "profile";
  const screen: Screen = ["profile", "questionnaire", "preferences", "consents"].includes(value) ? value as Screen : "profile";
  const policies: PublishedPolicies = query.get("policies") === "synthetic" ? Object.fromEntries(purposes.map(purpose =>
    [purpose, { version: "synthetic-v1", locale: "en-test", content: `TEST ONLY - NOT A LEGAL POLICY - ${purpose}` }])) : {};
  const settings = <MemberSettings screen={screen} publishedPolicies={policies} />;
  return <AuthProvider><MemberDrafts><main>{query.get("boundary") === "member" ? settings : <SessionBoundary>{settings}</SessionBoundary>}</main></MemberDrafts></AuthProvider>;
}
export default function MemberFixture() { return <Suspense fallback={<p>Loading test fixture…</p>}><Fixture /></Suspense>; }
