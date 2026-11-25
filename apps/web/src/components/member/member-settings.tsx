"use client";
import Link from "next/link";
import { useAuth } from "../auth/auth-provider";
import { PageHeader } from "../layout/page-layout";
import { LoadingState, Notice } from "../ui/status";
import { Screen, PublishedPolicies } from "@/lib/member-contracts";
import { ResourceEditor } from "./resource-editor";
import { ConsentSettings } from "./consent-settings";
import "./member-settings.css";

const titles: Record<Screen, string> = {
  profile: "Your profile",
  questionnaire: "Your questionnaire",
  preferences: "Your preferences",
  consents: "Your consent choices",
};
export function MemberSettingsNav() {
  return (
    <div className="member-hub-nav">
      <nav className="member-nav container" aria-label="Member navigation">
        <Link href="/account/matches">Discover & matches</Link>
        <Link href="/account/matches#connections">Connections & chat</Link>
        <Link href="/account/profile">Your profile</Link>
        <Link href="/account">Account</Link>
      </nav>
      <details className="container member-tools">
        <summary>Preferences, privacy & more</summary>
        <nav className="member-nav" aria-label="Member settings">
          {(Object.keys(titles) as Screen[]).map(screen => <Link key={screen} href={`/account/${screen}`}>{titles[screen]}</Link>)}
          <Link href="/account/videos">Your videos</Link>
          <Link href="/account/reviews">Your review reports</Link>
          <Link href="/account/safety">Safety choices</Link>
          <Link href="/account/closure">Close your account</Link>
        </nav>
      </details>
    </div>
  );
}
export function MemberSettings({
  screen,
  publishedPolicies,
}: {
  screen: Screen;
  publishedPolicies?: PublishedPolicies;
}) {
  const { state } = useAuth();
  if (state.status === "checking")
    return <LoadingState label="Checking your session…" />;
  if (state.status !== "authenticated")
    return (
      <Notice tone="error" title="Session unavailable">
        <Link href="/login?next=%2Faccount">Sign in</Link> to use your settings.
      </Notice>
    );
  if (state.user.role !== "MEMBER")
    return (
      <Notice tone="error" title="Access denied">
        These settings are only available to verified members.
      </Notice>
    );
  return (
    <div className="container member-settings">
      <MemberSettingsNav />
      <PageHeader
        title={titles[screen]}
        description={screen === "profile" ? "Tell your story: what you enjoy, what matters to you, and the relationship you’re looking for." : screen === "preferences" ? "Choose what matters in your next connection. Both people’s preferences must be respected." : screen === "questionnaire" ? "Take a moment to reflect. These answers are saved privately and do not currently affect recommendations." : "Choose how your information is used. Each permission is yours to grant or withdraw."}
      />
      {screen === "consents" ? (
        <ConsentSettings
          key={state.user.id}
          publishedPolicies={publishedPolicies}
        />
      ) : (
        <ResourceEditor key={`${state.user.id}:${screen}`} screen={screen} />
      )}
    </div>
  );
}
