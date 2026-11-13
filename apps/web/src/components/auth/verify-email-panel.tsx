"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, postAuth } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-form";
import { Button, ButtonLink } from "../ui/button";
import { Notice, LoadingState } from "../ui/status";
export function VerifyEmailPanel() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    if (value) {
      setToken(value);
      window.history.replaceState(null, "", "/verify-email");
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (complete) heading.current?.focus();
  }, [complete]);
  async function verify() {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      await postAuth("verify-email", { token });
      setComplete(true);
      setToken("");
    } catch (error) {
      setInvalid(error instanceof ApiError && error.status === 400);
      setMessage(authErrorMessage(error));
    } finally {
      setPending(false);
    }
  }
  if (!ready) return <LoadingState label="Reading your activation link…" />;
  if (complete)
    return (
      <div className="stack">
        <h2 ref={heading} tabIndex={-1} className="auth-form-title">
          Email verified.
        </h2>
        <Notice tone="success" title="Your email is confirmed.">
          Your account is active. Sign in with this email to continue. If you
          are using another account, sign out first.
        </Notice>
        <div>
          <ButtonLink href="/login">Sign in</ButtonLink>
        </div>
      </div>
    );
  return (
    <div className="stack">
      <h2 className="auth-form-title">Verify your email</h2>
      {!token ? (
        <Notice title="Open your activation link.">
          Use the link in your email. If you refreshed this page, open that
          email link again or request another one.
        </Notice>
      ) : (
        <>
          <p>
            Confirm that you want to activate your account. Opening this page
            alone does not activate it.
          </p>
          {message && (
            <Notice
              tone="error"
              title={
                invalid
                  ? "This link cannot be used."
                  : "Activation could not be completed."
              }
            >
              {message}
            </Notice>
          )}
          <div>
            <Button
              loading={pending}
              loadingLabel="Verifying email…"
              onClick={() => void verify()}
              disabled={invalid}
            >
              Verify email
            </Button>
          </div>
        </>
      )}
      <div className="inline">
        <ButtonLink variant="secondary" href="/resend-verification">
          Request another email
        </ButtonLink>
        <ButtonLink variant="quiet" href="/login">
          Back to sign in
        </ButtonLink>
      </div>
    </div>
  );
}
