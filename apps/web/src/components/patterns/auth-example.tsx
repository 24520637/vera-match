"use client";

import { useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  ErrorSummary,
  Form,
  FormActions,
  Input,
  focusFirstError,
} from "../ui/form";
import { Notice } from "../ui/status";

export function AuthExample() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [valid, setValid] = useState(false);
  function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const next: Record<string, string> = {};
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.get("email") ?? "").trim())
    )
      next["example-email"] =
        "Enter an email address, such as hello@example.com.";
    if (!String(data.get("password") ?? "").length)
      next["example-password"] = "Enter an example password to check the form.";
    setErrors(next);
    setValid(Object.keys(next).length === 0);
    if (Object.keys(next).length) focusFirstError(form);
  }
  return (
    <Card className="auth-example">
      <div className="stack">
        <div>
          <h3>Welcome back</h3>
          <p className="muted small">
            Form preview. Use example details; nothing is sent or stored.
          </p>
        </div>
        <Form
          noValidate
          onSubmit={validate}
          onChange={() => setValid(false)}
          aria-label="Authentication example"
        >
          <ErrorSummary
            errors={Object.entries(errors).map(([id, message]) => ({
              id,
              message,
            }))}
          />
          <Input
            id="example-email"
            name="email"
            label="Email address"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            autoCapitalize="none"
            required
            error={errors["example-email"]}
            placeholder="hello@example.com…"
          />
          <Input
            id="example-password"
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            error={errors["example-password"]}
            hint="Password managers and paste are supported."
          />
          <FormActions>
            <Button type="submit">Check example form</Button>
          </FormActions>
          {valid && (
            <Notice tone="success" title="The example fields are valid.">
              No sign-in request was sent. Account access is not implemented.
            </Notice>
          )}
        </Form>
      </div>
    </Card>
  );
}
