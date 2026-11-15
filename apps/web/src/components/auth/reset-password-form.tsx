"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, postAuth } from "@/lib/api";
import { authErrorMessage, authFieldErrors } from "@/lib/auth-form";
import { Button } from "../ui/button";
import { ErrorSummary, Form, FormActions, focusFirstError } from "../ui/form";
import { Notice } from "../ui/status";
import { PasswordInput } from "./password-input";
import { useRetryAfter } from "./use-retry-after";
import { RetryAfterFeedback } from "./retry-after-feedback";
import { useAuth } from "./auth-provider";

export function ResetPasswordForm() {
  const { refresh } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const initialized = useRef(false);
  const retry = useRetryAfter();
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    setToken(/^[A-Za-z0-9_-]{43}$/.test(value) ? value : "");
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
  }, []);
  useEffect(() => {
    if (complete) heading.current?.focus();
  }, [complete]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || pending || retry.seconds) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    const next: Record<string, string> = {};
    if (
      Array.from(newPassword).length < 12 ||
      Array.from(newPassword).length > 128
    )
      next["reset-newPassword"] = "Use between 12 and 128 characters.";
    if (confirmation !== newPassword || !confirmation)
      next["reset-confirmation"] = "Passwords must match.";
    setErrors(next);
    setMessage("");
    if (Object.keys(next).length) {
      focusFirstError(form);
      return;
    }
    setPending(true);
    try {
      const result = await postAuth<{ message: string }>("reset-password", {
        token,
        newPassword,
      });
      if (!result?.message) throw new Error("Invalid reset response");
      form.reset();
      setToken("");
      setComplete(true);
      // Recheck the existing server session, including when its cookie belongs to another account.
      void refresh();
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("vera-auth");
        channel.postMessage("changed");
        channel.close();
      }
    } catch (error) {
      retry.fromError(error);
      if (error instanceof ApiError && error.code === "INVALID_RESET_LINK") {
        setInvalid(true);
        setToken("");
        form.reset();
      } else {
        setErrors(authFieldErrors(error, "reset", ["newPassword"]));
        setMessage(authErrorMessage(error));
        focusFirstError(form);
      }
    } finally {
      setPending(false);
    }
  }
  if (complete)
    return (
      <div className="stack">
        <h2 ref={heading} tabIndex={-1} className="auth-form-title">
          Password updated.
        </h2>
        <Notice tone="success" title="Sign in again.">
          All existing sessions for this account have ended. Use your new
          password to sign in.
        </Notice>
        <p className="small">
          If this browser is signed in to another account, sign out before
          switching accounts.
        </p>
        <Link href="/login">Sign in</Link>
      </div>
    );
  if (token === null) return <p role="status">Preparing your reset form…</p>;
  if (!token || invalid)
    return (
      <div className="stack">
        <h2 className="auth-form-title">Request a new link</h2>
        <Notice tone="error" title="This link cannot be used.">
          Open the full link from your email. If it has expired or was already
          used, request a new one.
        </Notice>
        <Link href="/forgot-password">Request a new reset link</Link>
      </div>
    );
  return (
    <div className="stack">
      <h2 className="auth-form-title">Reset your password</h2>
      <Form noValidate onSubmit={submit} aria-label="Reset password">
        <ErrorSummary
          errors={Object.entries(errors).map(([id, message]) => ({
            id,
            message,
          }))}
        />
        <PasswordInput
          id="reset-newPassword"
          name="newPassword"
          label="New password"
          autoComplete="new-password"
          required
          disabled={pending}
          error={errors["reset-newPassword"]}
          hint="Use 12–128 characters. A long phrase of unrelated words is easier to remember. Avoid reusing a password."
        />
        <PasswordInput
          id="reset-confirmation"
          name="confirmation"
          label="Confirm new password"
          autoComplete="new-password"
          required
          disabled={pending}
          error={errors["reset-confirmation"]}
        />
        {message && (
          <Notice tone="error" title="The update could not be confirmed.">
            {message} Your entries are kept; try again when the connection is
            available.
          </Notice>
        )}
        <RetryAfterFeedback seconds={retry.seconds} id="reset-cooldown" />
        <FormActions>
          <Button
            type="submit"
            loading={pending}
            loadingLabel="Updating password…"
            disabled={retry.seconds > 0}
            aria-describedby={retry.seconds ? "reset-cooldown" : undefined}
          >
            Update password
          </Button>
        </FormActions>
      </Form>
      <p className="small">
        This link can be used once. Updating your password signs this account
        out on all devices.
      </p>
    </div>
  );
}
