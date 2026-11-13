"use client";

import { useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import {
  ErrorSummary,
  Fieldset,
  Form,
  FormActions,
  Textarea,
  focusFirstError,
} from "../ui/form";
import { Notice } from "../ui/status";

export function FormExample() {
  const [error, setError] = useState<string>();
  const [checked, setChecked] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("context") ?? "");
    const nextError = value.trim() ? undefined : "Enter some example context.";
    setError(nextError);
    setChecked(!nextError);
    if (nextError) focusFirstError(event.currentTarget);
  }

  return (
    <Form
      aria-label="Form states example"
      noValidate
      onSubmit={submit}
      onChange={() => setChecked(false)}
    >
      <ErrorSummary
        errors={error ? [{ id: "form-context", message: error }] : []}
      />
      <Fieldset legend="Descriptions and validation">
        <p id="form-example-context" className="small muted">
          Use fictional details in this preview.
        </p>
        <Textarea
          id="form-context"
          name="context"
          label="Example context"
          required
          maxLength={500}
          hint="Up to 500 characters. This example stays on this page."
          aria-describedby="form-example-context"
          error={error}
        />
        <Textarea
          name="unavailableContext"
          label="Unavailable context"
          disabled
          hint="Disabled example. This field is not submitted."
          defaultValue="Editing is unavailable in this example."
        />
      </Fieldset>
      <FormActions>
        <Button type="submit">Check form states</Button>
      </FormActions>
      {checked && (
        <Notice tone="success" title="Example context checked.">
          Nothing was sent or saved to an account.
        </Notice>
      )}
    </Form>
  );
}
