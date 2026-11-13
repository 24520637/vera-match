"use client";

import { useEffect, useState } from "react";
import {
  AuthLoadingBoundary,
  type AuthLoadingState,
} from "../../../src/components/auth/auth-loading-boundary";
import { Button } from "../../../src/components/ui/button";

export function SyntheticContent() {
  return <p data-testid="protected-content">Synthetic protected content</p>;
}

/** Test controls change presentation only; no authentication is performed. */
export function StateHarness() {
  const [state, setState] = useState<AuthLoadingState>("pending");
  const [hydrated, setHydrated] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  useEffect(() => setHydrated(true), []);

  return (
    <div data-testid="state-harness" data-state={state} className="stack">
      <h1>Authentication boundary test fixture</h1>
      <p data-testid="hydration">{hydrated ? "Hydrated" : "Server rendered"}</p>
      <nav aria-label="Synthetic state controls" className="inline">
        {(["pending", "authenticated", "unauthenticated", "forbidden", "error"] as const).map((value) => (
          <Button key={value} onClick={() => setState(value)}>
            Show {value}
          </Button>
        ))}
      </nav>
      <p data-testid="retry-count">Retry count: {retryCount}</p>
      <AuthLoadingBoundary
        state={state}
        onRetry={() => {
          setState("pending");
          setRetryCount((count) => count + 1);
        }}
      >
        <SyntheticContent />
      </AuthLoadingBoundary>
    </div>
  );
}
