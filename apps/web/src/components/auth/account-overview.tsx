"use client";
import { useAuth } from "./auth-provider";
import { PageHeader } from "../layout/page-layout";
import { ButtonLink } from "../ui/button";
import { MemberSettingsNav } from "../member/member-settings";
import { staffWorkspaces } from "@/lib/staff-workspaces";
import { LogoutControls } from "./logout-controls";
export function AccountOverview() {
  const { state } = useAuth();
  if (state.status !== "authenticated") return null;
  const workspace = state.user.role === "MEMBER" ? null : staffWorkspaces[state.user.role];
  return (
    <>
      <div className="container">
        <PageHeader
          title={`Welcome${state.user.displayName ? `, ${state.user.displayName}` : " to your account"}.`}
          description="Your session is active. You control what happens next."
        />
        <dl className="stack">
          <div>
            <dt className="small muted">Email address</dt>
            <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
              {state.user.email}
            </dd>
          </div>
          <div>
            <dt className="small muted">Account role</dt>
            <dd style={{ margin: 0 }}>{state.user.role.toLowerCase()}</dd>
          </div>
        </dl>
        <LogoutControls />
        {workspace && (
          <section className="section" aria-labelledby="account-work-heading">
            <h2 id="account-work-heading">{workspace.title}</h2>
            <p>{workspace.description}</p>
            <nav className="form-actions" aria-label="Staff tools">
              {workspace.links.map(link => (
                <ButtonLink key={link.href} href={link.href}>{link.label}</ButtonLink>
              ))}
              <ButtonLink variant="secondary" href="/staff-security">Staff security</ButtonLink>
            </nav>
          </section>
        )}
      </div>
      {state.user.role === "MEMBER" && <MemberSettingsNav />}
    </>
  );
}
