"use client";
import { useRef } from "react";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";

/** Confirmation is enabled only by the server-candidate workflow. */
export interface AssignmentConfirmationPreview {
  videoId: string;
  expertId: string;
  expectedCredentialRevision: number;
  dueAt: string | null;
  expiresAt: string | null;
}
export function AssignmentConfirmation({ open, onClose, preview, onConfirm, busy = false, disabled = false }: {
  open: boolean; onClose: () => void; preview?: Readonly<AssignmentConfirmationPreview>;
  onConfirm?: () => void; busy?: boolean; disabled?: boolean;
}) {
  const close = useRef<HTMLButtonElement>(null);
  return <Modal open={open} onOpenChange={value => { if (!value) onClose(); }}
    title={onConfirm ? "Confirm assignment" : "Assignment confirmation unavailable"}
    description={onConfirm ? "Review these references and dates. The server will recheck eligibility and consent before creating the assignment." : "Submission is unavailable without a server-verified candidate."}
    initialFocusRef={close} dismissible={!busy}>
    {preview && <dl>
      <dt>Video reference</dt><dd>{preview.videoId}</dd>
      <dt>Expert reference</dt><dd>{preview.expertId}</dd>
      <dt>Credential revision</dt><dd>{preview.expectedCredentialRevision}</dd>
      <dt>Work deadline</dt><dd>{preview.dueAt ?? "No deadline set"}</dd>
      <dt>Access expiration</dt><dd>{preview.expiresAt ?? "No additional assignment expiration"}</dd>
    </dl>}
    {!onConfirm && <p>No assignment will be created from this dialog.</p>}
    <div className="form-actions"><Button ref={close} variant="secondary" disabled={busy} onClick={onClose}>Back to queue</Button>
      <Button disabled={!onConfirm || !preview || disabled} loading={busy} onClick={onConfirm}>Confirm assignment</Button></div>
  </Modal>;
}
