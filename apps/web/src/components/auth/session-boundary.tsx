"use client";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "../ui/button";
import { LoadingState, Notice } from "../ui/status";
import { useAuth } from "./auth-provider";

export function SessionUnavailable({
  denied = false,
  server = false,
}: {
  denied?: boolean;
  server?: boolean;
}) {
  const router = useRouter();
  const { refresh } = useAuth();
  return (
    <div className="container page-heading">
      <h1>Account access</h1>
      <Notice
        tone={denied ? "warning" : "error"}
        title={
          denied
            ? "This account cannot open this page."
            : "We could not check your session."
        }
      >
        {denied
          ? "Your account does not have permission for this page."
          : "The service or connection is unavailable. This does not mean you have been signed out."}
      </Notice>
      <div className="inline">
        <Button
          onClick={() => {
            void refresh();
            if (server) router.refresh();
          }}
        >
          Try again
        </Button>
        <ButtonLink variant="quiet" href="/">
          Back to home
        </ButtonLink>
      </div>
    </div>
  );
}
export function SessionBoundary({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "unauthenticated")
      router.replace("/login?next=%2Faccount");
  }, [state.status, router]);
  if (state.status === "checking" || state.status === "unauthenticated")
    return (
      <div className="container page-heading">
        <LoadingState label="Checking your session…" />
      </div>
    );
  if (state.status === "unavailable" || state.status === "forbidden")
    return <SessionUnavailable denied={state.status === "forbidden"} />;
  return children;
}
