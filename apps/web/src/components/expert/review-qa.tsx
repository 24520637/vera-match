"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, apiJson } from "@/lib/api";
import { useAuth } from "../auth/auth-provider";
import { Button } from "../ui/button";
import { Notice } from "../ui/status";

type Entry = { id: string; version: number; submittedAt: string };
type Queue = { reviews: Entry[]; nextCursor: string | null };
type Review = Entry & {
  summary: string;
  limitations: string;
  observations: { category: string; startMs: number; endMs: number; observation: string; context: string }[];
};

function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) return "The review changed. Reload the queue before making a decision.";
    if (error.status === 401 || error.status === 403) return "An authorized moderator session with verified staff assurance is required.";
    if (error.status === 404) return "The submitted review is no longer available.";
  }
  return "The request could not be confirmed. Reload and try again.";
}

export function ReviewQa() {
  const { state } = useAuth();
  if (state.status === "checking") return <p role="status">Checking your session…</p>;
  if (state.status !== "authenticated" || state.user.role !== "MODERATOR")
    return <Notice title="Quality review unavailable">Sign in with an authorized moderator session.</Notice>;
  return <QueueWorkspace key={state.user.id} />;
}

function QueueWorkspace() {
  const [after, setAfter] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [queue, setQueue] = useState<Queue>();
  const [review, setReview] = useState<Review>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
    async function load() {
      if (selected) {
        const data = await apiJson<{ review: Review }>(`/qa/reviews/${selected}`, { signal });
        if (!data) throw new Error("Missing review.");
        if (!signal.aborted) setReview(data.review);
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

  async function returnReview() {
    if (!review || !reason.trim() || saving || loading) return;
    const signal = request.current!.signal;
    setSaving(true);
    setError("");
    try {
      await apiJson(`/qa/reviews/${review.id}/return`, {
        method: "POST", signal, json: { expectedVersion: review.version, reason },
      });
      if (signal.aborted) return;
      setResult("Review returned to the expert.");
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

  return <main className="container page-heading">
    <h1>Review quality assurance</h1>
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
      <ol>{review.observations.map((note, index) => <li key={index}>
        <p>{note.category} · {note.startMs}–{note.endMs} ms</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{note.observation}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>Context: {note.context}</p>
      </li>)}</ol>
      <form onSubmit={event => { event.preventDefault(); void returnReview(); }}>
        <p><label>What should the expert change?<br />
          <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required disabled={saving} />
        </label></p>
        <Button type="submit" disabled={!reason.trim()} loading={saving}>Return for revision</Button>
      </form>
    </>}
  </main>;
}
