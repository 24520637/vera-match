"use client";
import Link from "next/link";
import { useAuth } from "./auth-provider";
import { staffWorkspaces } from "@/lib/staff-workspaces";
export function AuthNavigation({ onNavigate }: { onNavigate: () => void }) {
  const { state } = useAuth();
  if (state.status === "checking")
    return (
      <span className="small muted" role="status">
        Checking session…
      </span>
    );
  if (state.status === "unauthenticated")
    return (
      <Link href="/login" onClick={onNavigate}>
        Sign in
      </Link>
    );
  return (
    <>
      {state.status === "authenticated" && state.user.role === "MEMBER" && <>
        <Link href="/account/matches" onClick={onNavigate}>Discover</Link>
        <Link href="/account/matches#connections" onClick={onNavigate}>Connections</Link>
        <Link href="/account/profile" onClick={onNavigate}>My profile</Link>
      </>}
      <Link href="/account" onClick={onNavigate}>
        {state.status === "authenticated"
          ? "Your account"
          : "Check account access"}
      </Link>
      {state.status === "authenticated" && state.user.role !== "MEMBER" && <Link href="/staff-security" onClick={onNavigate}>Staff security</Link>}
      {state.status === "authenticated" && state.user.role !== "MEMBER" &&
        staffWorkspaces[state.user.role].links.map(link => (
          <Link key={link.href} href={link.href} onClick={onNavigate}>
            {link.label}
          </Link>
        ))}
    </>
  );
}
