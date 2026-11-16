"use client";
import Link from "next/link";
import { useAuth } from "../auth/auth-provider";
import { PageHeader } from "../layout/page-layout";
import { LoadingState, Notice } from "../ui/status";
import { Screen, PublishedPolicies } from "@/lib/member-contracts";
import { ResourceEditor } from "./resource-editor";
import { ConsentSettings } from "./consent-settings";
import "./member-settings.css";

const titles: Record<Screen, string> = { profile: "Your profile", questionnaire: "Your questionnaire", preferences: "Your preferences", consents: "Your consent choices" };
export function MemberSettingsNav() {
  return <nav className="member-nav container" aria-label="Member settings">
    {(Object.keys(titles) as Screen[]).map(screen => <Link key={screen} href={`/account/${screen}`}>{titles[screen]}</Link>)}
  </nav>;
}
export function MemberSettings({ screen, publishedPolicies = {} }: { screen: Screen; publishedPolicies?: PublishedPolicies }) {
  const { state } = useAuth();
  if (state.status === "checking") return <LoadingState label="Checking your session…" />;
  if (state.status !== "authenticated") return <Notice tone="error" title="Session unavailable"><Link href="/login?next=%2Faccount">Sign in</Link> to use your settings.</Notice>;
  if (state.user.role !== "MEMBER") return <Notice tone="error" title="Access denied">These settings are only available to verified members.</Notice>;
  return <div className="container member-settings">
    <MemberSettingsNav />
    <PageHeader title={titles[screen]} description="Your choices stay private. Save only the changes you intend to make." />
    {screen === "consents" ? <ConsentSettings key={state.user.id} publishedPolicies={publishedPolicies} />
      : <ResourceEditor key={`${state.user.id}:${screen}`} screen={screen} />}
  </div>;
}
