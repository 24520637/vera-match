"use client";
import { useRetryAfter } from "./use-retry-after";
import { RetryAfterFeedback } from "./retry-after-feedback";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, postAuth } from "@/lib/api";
import { Button } from "../ui/button";
import { FormActions } from "../ui/form";
import { Modal } from "../ui/modal";
import { Notice } from "../ui/status";
import { useAuth } from "./auth-provider";
export function LogoutControls() {
  const retry = useRetryAfter();
  const { clearUser } = useAuth();
  const router = useRouter();
  const safeAction = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState<"current" | "all" | null>(null);
  const [error, setError] = useState("");
  async function logout(all: boolean) {
    if (pending || retry.seconds > 0) return;
    setPending(all ? "all" : "current");
    setError("");
    try {
      await postAuth<void>(all ? "logout-all" : "logout", {});
      clearUser();
      router.replace("/login");
      router.refresh();
    } catch (failure) {
      retry.fromError(failure);
      if (failure instanceof ApiError && failure.status === 401) {
        clearUser();
        router.replace("/login");
        router.refresh();
      } else
        setError(
          failure instanceof ApiError
            ? failure.message
            : "Sign-out could not be confirmed. Try again.",
        );
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="stack">
      {error && !confirm && (
        <Notice tone="error" title="Sign-out could not be confirmed.">
          {error}
        </Notice>
      )}
      {!confirm && (
        <RetryAfterFeedback seconds={retry.seconds} id="logout-retry-after" />
      )}
      <FormActions>
        <Button
          variant="secondary"
          aria-describedby={retry.seconds ? "logout-retry-after" : undefined}
          loading={pending === "current"}
          loadingLabel="Signing out…"
          disabled={!!pending || retry.seconds > 0}
          onClick={() => void logout(false)}
        >
          Sign out
        </Button>
        <Button
          variant="quiet"
          disabled={!!pending}
          onClick={() => {
            setError("");
            setConfirm(true);
          }}
        >
          Sign out on all devices
        </Button>
      </FormActions>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        dismissible={!pending}
        initialFocusRef={safeAction}
        title="Sign out everywhere?"
        description="This revokes active sessions for your account on all devices. You will need to sign in again."
      >
        <div className="stack">
          {confirm && error && (
            <Notice tone="error" title="Sign-out could not be confirmed.">
              {error}
            </Notice>
          )}
          {confirm && (
            <RetryAfterFeedback
              seconds={retry.seconds}
              id="logout-all-retry-after"
            />
          )}
          <FormActions>
            <Button
              ref={safeAction}
              variant="secondary"
              disabled={!!pending}
              onClick={() => setConfirm(false)}
            >
              Keep me signed in
            </Button>
            <Button
              variant="danger"
              disabled={retry.seconds > 0}
              aria-describedby={
                retry.seconds ? "logout-all-retry-after" : undefined
              }
              loading={pending === "all"}
              loadingLabel="Signing out…"
              onClick={() => void logout(true)}
            >
              Sign out everywhere
            </Button>
          </FormActions>
        </div>
      </Modal>
    </div>
  );
}
