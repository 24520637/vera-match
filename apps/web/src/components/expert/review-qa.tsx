"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, apiJson } from "@/lib/api";
import { useAuth } from "../auth/auth-provider";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";
import { Notice } from "../ui/status";
import { ReviewDisputes } from "./review-disputes";

type Entry = { id: string; version: number; submittedAt: string };
type Queue = { reviews: Entry[]; nextCursor: string | null };
type Review = Entry & {
  summary: string;
  limitations: string;
  observations: { id: string; category: string; startMs: number; endMs: number; observation: string; context: string }[];
};
type ClaimType = { type: string; statement: string };
type ClaimEvidence = { observationId: string; context: string; transcript: string };

function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) return "The review changed. Reload the queue before making a decision.";
    if (error.status === 401 || error.status === 403) return "An authorized moderator session with verified staff assurance is required.";
    if (error.status === 404) return "The submitted review is no longer available.";
    if (error.status === 422 || error.code === "REVIEW_DURATION_UNAVAILABLE")
      return "This review cannot be approved. Return it with the changes needed.";
  }
  return "The request could not be confirmed. Reload and try again.";
}

export function ReviewQa() {
  const { state } = useAuth();
  if (state.status === "checking") return <p role="status">Checking your session…</p>;
  if (state.status !== "authenticated" || state.user.role !== "MODERATOR")
    return <Notice title="Quality review unavailable">Sign in with an authorized moderator session.</Notice>;
  return <ModeratorWorkspace key={state.user.id} />;
}

function ModeratorWorkspace() {
  const [disputes, setDisputes] = useState(false);
  return disputes ? <ReviewDisputes close={() => setDisputes(false)} /> : <QueueWorkspace openDisputes={() => setDisputes(true)} />;
}

function QueueWorkspace({ openDisputes }: { openDisputes: () => void }) {
  const [after, setAfter] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [queue, setQueue] = useState<Queue>();
  const [review, setReview] = useState<Review>();
  const [claimTypes, setClaimTypes] = useState<ClaimType[]>([]);
  const [claims, setClaims] = useState<Record<string, ClaimEvidence>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [revision, reload] = useState(0);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setLoading(true);
    setError("");
    setQueue(undefined);
    setReview(undefined);
    setReason("");
    setClaims({});
    async function load() {
      if (selected) {
        const data = await apiJson<{ review: Review; claimTypes: ClaimType[] }>(`/qa/reviews/${selected}`, { signal });
        if (!data) throw new Error("Missing review.");
        if (!signal.aborted) {
          setReview(data.review);
          setClaimTypes(data.claimTypes);
        }
      } else {
        const query = after ? `?after=${encodeURIComponent(after)}` : "";
        const data = await apiJson<Queue>(`/qa/reviews${query}`, { signal });
        if (!data) throw new Error("Missing queue.");
        if (!signal.aborted) setQueue(data);
      }
    }
    void load().catch(error => { if (!signal.aborted) setError(message(error)); })
      .finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [after, selected, revision]);

  async function decide(action: "return" | "approve") {
    if (!review || (action === "return" && !reason.trim()) || saving || loading) return;
    const signal = request.current!.signal;
    setSaving(true);
    setConfirming(false);
    setError("");
    try {
      await apiJson(`/qa/reviews/${review.id}/${action}`, {
        method: "POST", signal, json: { expectedVersion: review.version, ...(action === "return" ? { reason } : {
          claims: Object.entries(claims).map(([type, evidence]) => ({
            type, observationId: evidence.observationId, context: evidence.context,
            transcript: evidence.transcript.trim() || undefined,
          })),
        }) },
      });
      if (signal.aborted) return;
      setResult(action === "approve" ? "Review approved." : "Review returned to the expert.");
      setReview(undefined);
      setSelected(undefined);
      setAfter(undefined);
    } catch (error) {
      if (!signal.aborted) {
        if (error instanceof ApiError && [401, 403, 404, 409].includes(error.status ?? 0)) setReview(undefined);
        setError(message(error));
      }
    } finally {
      if (!signal.aborted) setSaving(false);
    }
  }

  function open(id?: string) {
    setQueue(undefined);
    setReview(undefined);
    setResult("");
    setSelected(id);
  }

  const speech = review?.observations.filter(note => note.category === "SPEECH") ?? [];
  const missingEvidence = Object.values(claims).some(claim => !claim.observationId || !claim.context.trim());

  return <div className="container page-heading">
    <h1>Review quality assurance</h1>
    <Button variant="secondary" disabled={saving} onClick={openDisputes}>Review disputes</Button>
    {loading && <p role="status">Loading reviews…</p>}
    {result && <p role="status">{result}</p>}
    {error && <Notice title="Review request failed" tone="error">{error}</Notice>}
    {selected && <Button variant="secondary" disabled={saving} onClick={() => open()}>Back to submitted reviews</Button>}
    {error && <Button variant="quiet" disabled={saving} onClick={() => reload(value => value + 1)}>Reload</Button>}
    {queue && <>
      <h2>Submitted reviews</h2>
      {queue.reviews.length === 0 && <p>No submitted reviews are available.</p>}
      <ul>{queue.reviews.map(entry => <li key={entry.id}>
        <Button variant="quiet" onClick={() => open(entry.id)}>Open review {entry.id}</Button>
        {" "}Version {entry.version} · <time dateTime={entry.submittedAt}>{new Date(entry.submittedAt).toLocaleDateString()}</time>
      </li>)}</ul>
      {after && <Button variant="secondary" onClick={() => setAfter(undefined)}>First page</Button>}
      {queue.nextCursor && <Button variant="secondary" onClick={() => setAfter(queue.nextCursor ?? undefined)}>Next page</Button>}
    </>}
    {review && <>
      <h2>Submitted version {review.version}</h2>
      <h3>Summary</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{review.summary}</p>
      <h3>Limitations</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{review.limitations}</p>
      <h3>Timeline observations</h3>
      {review.observations.length === 0 && <p>No timecoded observations were submitted.</p>}
      <ol>{review.observations.map(note => <li key={note.id}>
        <p>{note.category} · {note.startMs}–{note.endMs} ms</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{note.observation}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>Context: {note.context}</p>
      </li>)}</ol>
      {speech.length > 0 && <fieldset disabled={saving}>
        <legend>Factual claims for owner confirmation (optional)</legend>
        {claimTypes.map(({ type, statement }) => {
          const evidence = claims[type];
          function update(change: Partial<ClaimEvidence>) {
            setClaims(current => ({ ...current, [type]: { ...current[type], ...change } }));
          }
          return <div key={type}>
            <label><input type="checkbox" checked={!!evidence} onChange={event => {
              const checked = event.target.checked;
              setClaims(current => {
                const next = { ...current };
                if (checked) next[type] = { observationId: "", context: "", transcript: "" };
                else delete next[type];
                return next;
              });
            }} /> {statement}</label>
            {evidence && <fieldset>
              <legend>Evidence for {statement}</legend>
              <p><label>Speech observation<br />
                <select value={evidence.observationId} onChange={event =>
                  update({ observationId: event.target.value, context: "", transcript: "" })}>
                  <option value="">Select an observation</option>
                  {speech.map(note => <option key={note.id} value={note.id}>
                    {note.startMs}–{note.endMs} ms · {note.observation.slice(0, 100)}
                  </option>)}
                </select>
              </label></p>
              <p><label>Context<br />
                <textarea value={evidence.context} maxLength={1000} onChange={event => update({ context: event.target.value })} />
              </label></p>
              <p><label>Manual transcript (optional)<br />
                <textarea value={evidence.transcript} maxLength={2000} onChange={event => update({ transcript: event.target.value })} />
              </label></p>
            </fieldset>}
          </div>;
        })}
      </fieldset>}
      <Button disabled={saving || missingEvidence} onClick={() => setConfirming(true)}>Approve review</Button>
      <form onSubmit={event => { event.preventDefault(); void decide("return"); }}>
        <p><label>What should the expert change?<br />
          <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required disabled={saving} />
        </label></p>
        <Button type="submit" disabled={!reason.trim()} loading={saving}>Return for revision</Button>
      </form>
    </>}
    <Modal open={confirming} onOpenChange={setConfirming} title="Approve this review?"
      description="The review and any selected factual claims will be approved together. Claim sharing requires a separate decision from the member.">
      <Button variant="secondary" onClick={() => setConfirming(false)}>Keep reviewing</Button>
      <Button onClick={() => void decide("approve")}>Confirm approval</Button>
    </Modal>
  </div>;
}
