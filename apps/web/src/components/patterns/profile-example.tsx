"use client";

import { useRef, useState, type FormEvent } from "react";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { Button } from "../ui/button";
import {
  Checkbox,
  ErrorSummary,
  Fieldset,
  Form,
  FormActions,
  Input,
  Select,
  Textarea,
  focusFirstError,
} from "../ui/form";
import { Modal } from "../ui/modal";
import { Notice } from "../ui/status";

export function ProfileExample() {
  const formRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [dirty, setDirty] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useUnsavedChanges(dirty);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: Record<string, string> = {};
    if (!String(data.get("displayName") ?? "").trim())
      next["profile-name"] = "Enter the name you want to display.";
    if (!data.get("goal"))
      next["profile-goal"] = "Choose a relationship intention.";
    setErrors(next);
    setPreview(Object.keys(next).length === 0);
    if (Object.keys(next).length) focusFirstError(event.currentTarget);
    else setDirty(false);
  }

  function reset() {
    formRef.current?.reset();
    setErrors({});
    setDirty(false);
    setPreview(false);
    setResetOpen(false);
  }

  return (
    <>
      <Form
        ref={formRef}
        noValidate
        onSubmit={submit}
        onChange={() => {
          setDirty(true);
          setPreview(false);
        }}
        aria-label="Profile example"
      >
        <ErrorSummary
          errors={Object.entries(errors).map(([id, message]) => ({
            id,
            message,
          }))}
        />
        <Fieldset legend="A little about you">
          <Input
            id="profile-name"
            name="displayName"
            label="Display name"
            autoComplete="nickname"
            maxLength={80}
            required
            error={errors["profile-name"]}
            placeholder="Your first name…"
          />
          <Select
            id="profile-goal"
            name="goal"
            label="Relationship intention"
            autoComplete="off"
            required
            defaultValue=""
            error={errors["profile-goal"]}
          >
            <option value="" disabled>
              Choose an intention
            </option>
            <option value="long-term">A long-term relationship</option>
            <option value="exploring">Exploring what feels right</option>
          </Select>
          <Textarea
            id="profile-about"
            name="about"
            label="What makes a good day for you?"
            autoComplete="off"
            maxLength={500}
            hint="Optional. Up to 500 characters. Share only what feels comfortable."
          />
        </Fieldset>
        <Fieldset legend="Your sharing choices">
          <Checkbox
            name="profileMatching"
            label="Use this profile for matching"
            hint="Off by default. This example changes only the checkbox on this page."
          />
          <Checkbox
            name="reviewSharing"
            label="Share individually approved factual claims"
            hint="Separate permission. QA approval and your confirmation are also required."
          />
        </Fieldset>
        <FormActions>
          <Button type="submit">Preview profile</Button>
          <Button
            variant="quiet"
            onClick={() => (dirty ? setResetOpen(true) : reset())}
          >
            Reset example
          </Button>
        </FormActions>
        <p className="small muted">
          Page-local example. No profile or consent is saved to your account.
        </p>
        {preview && (
          <Notice tone="success" title="Profile example checked.">
            Your choices remain on this page only. Nothing was saved to an
            account.
          </Notice>
        )}
      </Form>
      <Modal
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset this example?"
        description="The details you entered on this page will be cleared."
        initialFocusRef={cancelRef}
      >
        <FormActions>
          <Button
            ref={cancelRef}
            variant="secondary"
            onClick={() => setResetOpen(false)}
          >
            Keep editing
          </Button>
          <Button variant="danger" onClick={reset}>
            Reset example
          </Button>
        </FormActions>
      </Modal>
    </>
  );
}
