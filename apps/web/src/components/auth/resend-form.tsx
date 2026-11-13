"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { postAuth } from "@/lib/api";
import { authErrorMessage, authFieldErrors } from "@/lib/auth-form";
import { Button } from "../ui/button";
import {
  ErrorSummary,
  Form,
  FormActions,
  Input,
  focusFirstError,
} from "../ui/form";
import { Notice } from "../ui/status";
export function ResendForm() {
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [complete, setComplete] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cooldown) return;
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    setMessage("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      setErrors({ "resend-email": "Enter your email address." });
      focusFirstError(form);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const result = await postAuth<{ retryAfterSeconds?: number }>(
        "resend-verification",
        { email },
      );
      setComplete(true);
      setCooldown(
        typeof result.retryAfterSeconds === "number"
          ? Math.max(1, Math.min(3600, result.retryAfterSeconds))
          : 60,
      );
    } catch (error) {
      setErrors(authFieldErrors(error, "resend", ["email"]));
      setMessage(authErrorMessage(error));
      focusFirstError(form);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack">
      <h2 className="auth-form-title">Request another email</h2>
      <Form noValidate onSubmit={submit} aria-label="Resend activation email">
        <ErrorSummary
          errors={Object.entries(errors).map(([id, message]) => ({
            id,
            message,
          }))}
        />
        <Input
          id="resend-email"
          name="email"
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          required
          disabled={pending}
          error={errors["resend-email"]}
        />
        {complete && (
          <Notice tone="success" title="Activation request received.">
            If this address still needs activation, check its inbox.
          </Notice>
        )}
        {message && (
          <Notice tone="error" title="The request could not be completed.">
            {message}
          </Notice>
        )}
        <FormActions>
          <Button
            type="submit"
            loading={pending}
            loadingLabel="Requesting email…"
            disabled={cooldown > 0}
            aria-describedby={cooldown ? "resend-cooldown" : undefined}
          >
            Request activation email
          </Button>
        </FormActions>
        {cooldown > 0 && (
          <p id="resend-cooldown" className="small muted">
            You can request another email in{" "}
            {new Intl.NumberFormat("en").format(cooldown)} seconds.
          </p>
        )}
      </Form>
      <p className="small">
        Email already activated? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
