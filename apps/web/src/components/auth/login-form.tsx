"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, postAuth } from "@/lib/api";
import { isAuthUser } from "@/lib/auth-types";
import { readRememberedEmail, rememberEmail } from "@/lib/remember-email";
import { Button } from "../ui/button";
import {
  Checkbox,
  ErrorSummary,
  Form,
  FormActions,
  Input,
  focusFirstError,
} from "../ui/form";
import { Notice } from "../ui/status";
import { useAuth } from "./auth-provider";
import { PasswordInput } from "./password-input";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const { state, acceptUser } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const saved = readRememberedEmail(localStorage);
      setEmail(saved.email);
      setRemember(!!saved.email);
      setStorageAvailable(saved.available);
    } catch {
      setStorageAvailable(false);
    }
  }, []);
  useEffect(() => {
    if (state.status === "authenticated") {
      router.replace(nextPath);
      router.refresh();
    }
  }, [state.status, nextPath, router]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254)
      next["login-email"] = "Enter your email address.";
    if (!password || Array.from(password).length > 128)
      next["login-password"] = "Enter your password.";
    setErrors(next);
    setMessage("");
    if (Object.keys(next).length) {
      focusFirstError(form);
      return;
    }
    setPending(true);
    try {
      const user = await postAuth<unknown>("login", { email, password });
      if (!isAuthUser(user)) throw new Error("Invalid sign-in response");
      try {
        rememberEmail(localStorage, user.email, remember);
      } catch {
        /* Remembering email is optional; authentication still succeeded. */
      }
      acceptUser(user);
    } catch (error) {
      if (error instanceof ApiError && error.details?.length) {
        setErrors(
          Object.fromEntries(
            error.details
              .filter((detail) => ["email", "password"].includes(detail.field))
              .map((detail) => [
                `login-${detail.field}`,
                detail.messages.join(" "),
              ]),
          ),
        );
        focusFirstError(form);
      }
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Sign-in is temporarily unavailable. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack">
      <h2 className="auth-form-title">Sign in</h2>
      <Form noValidate onSubmit={submit} aria-label="Sign in">
        <ErrorSummary
          errors={Object.entries(errors).map(([id, message]) => ({
            id,
            message,
          }))}
        />
        <Input
          id="login-email"
          name="email"
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          error={errors["login-email"]}
        />
        <PasswordInput
          id="login-password"
          name="password"
          label="Password"
          autoComplete="current-password"
          required
          disabled={pending}
          error={errors["login-password"]}
        />
        <Checkbox
          name="rememberEmail"
          label="Remember email on this device"
          checked={remember}
          onChange={(event) => {
            setRemember(event.target.checked);
            if (!event.target.checked) {
              try {
                rememberEmail(localStorage, "", false);
              } catch {
                setStorageAvailable(false);
              }
            }
          }}
          disabled={pending || !storageAvailable}
          hint={
            storageAvailable
              ? "Optional. Saves your email only, never your password or session."
              : "This browser cannot remember email. You can still sign in."
          }
        />
        {message && (
          <Notice tone="error" title="Sign-in could not be completed.">
            {message}
          </Notice>
        )}
        <FormActions>
          <Button type="submit" loading={pending} loadingLabel="Signing in…">
            Sign in
          </Button>
        </FormActions>
      </Form>
      <p className="small muted">
        Not activated yet?{" "}
        <Link href="/resend-verification">Request an activation email</Link>.
      </p>
      <p className="small">
        New here? <Link href="/register">Create an account</Link>
      </p>
    </div>
  );
}
