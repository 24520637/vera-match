"use client";

import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { LoadingState, Notice } from "../ui/status";

export type AuthLoadingState =
  | "pending"
  | "authenticated"
  | "unauthenticated"
  | "forbidden"
  | "error";

/** Presentation only. The session owner supplies state after server validation. */
export function AuthLoadingBoundary({
  state = "pending",
  onRetry,
  children,
}: {
  state?: AuthLoadingState;
  onRetry?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Session access"
      aria-busy={state === "pending"}
      className={state === "authenticated" ? undefined : "page-heading"}
    >
      {state === "authenticated" ? children : state === "pending" ? (
        <LoadingState label="Checking your session…" />
      ) : state === "unauthenticated" ? (
        <Notice title="Sign-in is required.">
          Sign in to access this area when account services are available.
        </Notice>
      ) : state === "forbidden" ? (
        <Notice tone="warning" title="Access is unavailable.">
          Your account does not have permission to view this area.
        </Notice>
      ) : (
        <>
          <Notice tone="error" title="We could not check your session.">
            {onRetry
              ? "Try checking again. This error does not mean you are signed out."
              : "Please try again later. This error does not mean you are signed out."}
          </Notice>
          {onRetry && (
            <div>
              <Button onClick={onRetry}>Try again</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
