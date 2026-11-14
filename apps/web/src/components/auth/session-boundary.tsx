"use client";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ButtonLink } from "../ui/button";
import { AuthLoadingBoundary } from "./auth-loading-boundary";
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
      <AuthLoadingBoundary
        state={denied ? "forbidden" : "error"}
        onRetry={() => {
          void refresh();
          if (server) router.refresh();
        }}
      >
        <></>
      </AuthLoadingBoundary>
      <div className="inline">
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
      <div className="container">
        <AuthLoadingBoundary
          state={state.status === "checking" ? "pending" : "unauthenticated"}
        >
          {children}
        </AuthLoadingBoundary>
      </div>
    );
  if (state.status === "unavailable" || state.status === "forbidden")
    return <SessionUnavailable denied={state.status === "forbidden"} />;
  return (
    <AuthLoadingBoundary state="authenticated">{children}</AuthLoadingBoundary>
  );
}
