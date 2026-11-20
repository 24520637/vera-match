"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { checkAssignmentCandidate, createAssignment, type AssignmentCandidate, type AssignmentRequest } from "@/lib/expert-queue-api";
import { queueFailure } from "@/lib/expert-queue-view";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
import { Input } from "../ui/form";
import { Button } from "../ui/button";
import { Notice } from "../ui/status";
import { AssignmentConfirmation } from "./assignment-confirmation";

type Operation = { key: string; body: AssignmentRequest; uncertain?: boolean };
// Browser memory only. Retain an unresolved operation for the same verified user
// across temporary session loss; never replay it automatically or expose it to B.
const unresolved = new Map<string, Operation>();
function utc(value: string) {
  if (!value.trim()) return null;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new Error("Use a UTC timestamp with milliseconds, or leave the date empty.");
  return value;
}
export function AssignmentComposer({ ownerId }: { ownerId: string }) {
  const [video, setVideo] = useState(""), [expert, setExpert] = useState("");
  const [due, setDue] = useState(""), [expires, setExpires] = useState("");
  const [candidate, setCandidate] = useState<AssignmentCandidate>(), [preview, setPreview] = useState<AssignmentRequest>();
  const [pending, setPending] = useState<Operation | undefined>(() => unresolved.get(ownerId));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [errorTitle, setErrorTitle] = useState("Assignment not confirmed"), [receipt, setReceipt] = useState("");
  const [knownRejected, setKnownRejected] = useState(false);
  const retry = useRetryAfter(), alive = useRef(true), working = useRef(false), source = useRef<AbortController | undefined>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; source.current?.abort(); }; }, []);
  function changed() { setCandidate(undefined); setPreview(undefined); setReceipt(""); }
  async function check() {
    if (working.current || pending || retry.seconds) return;
    working.current = true; setBusy(true); setError(""); setErrorTitle("Candidate could not be confirmed"); setCandidate(undefined);
    const controller = new AbortController(); source.current?.abort(); source.current = controller;
    try {
      const value = await checkAssignmentCandidate(video, expert, controller.signal);
      if (alive.current && !controller.signal.aborted) setCandidate(value);
    } catch (failure) { if (alive.current && !controller.signal.aborted) { setError(queueFailure(failure).message); retry.fromError(failure); } }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  function review() {
    if (!candidate) return;
    try {
      const dueAt = utc(due), expiresAt = utc(expires);
      if (dueAt && expiresAt && dueAt > expiresAt) throw new Error("The work deadline must not exceed access expiration.");
      setPreview({ ...candidate, dueAt, expiresAt }); setError("");
    } catch (failure) { setError((failure as Error).message); }
  }
  async function submit(original?: Operation) {
    if (working.current || retry.seconds || (!original && !preview)) return;
    const operation = original ?? { key: crypto.randomUUID(), body: preview! };
    unresolved.set(ownerId, operation); setPending(operation); setPreview(undefined);
    working.current = true; setBusy(true); setError(""); setErrorTitle("Assignment not confirmed"); setKnownRejected(false);
    try {
      const value = await createAssignment(operation.body, operation.key);
      if (unresolved.get(ownerId)?.key === operation.key) unresolved.delete(ownerId);
      if (alive.current) { setPending(undefined); setCandidate(undefined); setReceipt(value!.assignment.id); }
    } catch (failure) {
      // C033 emits this release-gate response before opening its mutation
      // transaction, so it is a confirmed no-write outcome, not an unknown receipt.
      const confirmedNoWrite = failure instanceof ApiError && failure.code === "ASSIGNMENT_ASSURANCE_UNAVAILABLE";
      const uncertain = !confirmedNoWrite && (!(failure instanceof ApiError) || failure.kind !== "http" || (failure.status ?? 500) >= 500);
      const current = unresolved.get(ownerId);
      const retained = { ...operation, uncertain: current?.uncertain || operation.uncertain || uncertain };
      // A request from an unmounted screen must not overwrite a newer operation,
      // or resurrect one already reconciled by another mounted instance.
      if (current?.key === operation.key) {
        if (confirmedNoWrite) unresolved.delete(ownerId);
        else unresolved.set(ownerId, retained);
      }
      if (alive.current) {
        setPending(confirmedNoWrite ? undefined : retained);
        setErrorTitle(confirmedNoWrite ? "Assignment was not created" : "Assignment not confirmed");
        if (confirmedNoWrite) setCandidate(undefined);
        setError(confirmedNoWrite ? queueFailure(failure).message : queueFailure(failure).message + " The original request is retained; do not start a replacement while its outcome is unknown."); retry.fromError(failure);
        setKnownRejected(!retained.uncertain && failure instanceof ApiError && ([400, 404, 409].includes(failure.status ?? 0) || confirmedNoWrite) && failure.code !== "IDEMPOTENCY_KEY_REUSED");
      }
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="container expert-queue" aria-labelledby="assignment-create-heading">
    <h2 id="assignment-create-heading">Create an assignment</h2>
    <p>Use known opaque references. This checks one pair; it is not a public search or a directory of members. Eligibility is rechecked on creation.</p>
    {error && <Notice tone="error" title={errorTitle}>{error}</Notice>}
    {receipt && <Notice tone="success" title="Creation receipt confirmed">Reference: {receipt}. This is a historical receipt, not current access authorization. Refresh the queue.</Notice>}
    <RetryAfterFeedback id="assignment-create-retry" seconds={retry.seconds} />
    {pending ? <Notice tone="warning" title="Original assignment request retained">
      <p>Video reference: {pending.body.videoId}. Expert reference: {pending.body.expertId}.</p>
      <Button disabled={busy || retry.seconds > 0} onClick={() => void submit(pending)}>Retry original request</Button>
      {knownRejected && <Button variant="secondary" disabled={busy} onClick={() => { unresolved.delete(ownerId); setPending(undefined); setCandidate(undefined); setError(""); }}>Review candidates again</Button>}
    </Notice> : <>
      <Input name="videoId" label="Video reference" value={video} disabled={busy} onChange={event => { setVideo(event.target.value); changed(); }} />
      <Input name="expertId" label="Expert reference" value={expert} disabled={busy} onChange={event => { setExpert(event.target.value); changed(); }} />
      <Button disabled={busy || retry.seconds > 0 || !video || !expert} onClick={() => void check()}>Check candidate pair</Button>
      {candidate && <>
        <Notice title="Candidate pair verified">Video {candidate.videoId}; expert {candidate.expertId}; credential revision {candidate.expectedCredentialRevision}. This result can become stale.</Notice>
        <Input name="dueAt" label="Work deadline (UTC, optional)" value={due} hint="Leave empty for null; use YYYY-MM-DDTHH:mm:ss.sssZ." onChange={event => setDue(event.target.value)} />
        <Input name="expiresAt" label="Access expiration (UTC, optional)" value={expires} hint="Leave empty for null. The server enforces evidence expiry." onChange={event => setExpires(event.target.value)} />
        <Button disabled={busy || retry.seconds > 0} onClick={review}>Review assignment</Button>
      </>}
    </>}
    <AssignmentConfirmation open={!!preview} onClose={() => setPreview(undefined)} preview={preview} onConfirm={() => void submit()} busy={busy} disabled={retry.seconds > 0} />
  </section>;
}
