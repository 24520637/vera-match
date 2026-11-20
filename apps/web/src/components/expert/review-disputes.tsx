"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, apiJson } from "@/lib/api";
import { Button } from "../ui/button";
import { Notice } from "../ui/status";

type Entry = { id: string; reviewId: string; status: string; createdAt: string };
type Queue = { disputes: Entry[]; nextCursor: string | null };
type Dispute = Omit<Entry, "reviewId"> & { claimId: string | null; reason: string; resolution: string | null; revision: number };
type Case = {
  reviewId: string;
  dispute: Dispute;
  report: { version: number; summary: string; limitations: string; approvedAt: string } | null;
  claim: { statement: string; evidence: { startMs: number; endMs: number; context: string; transcript: string | null } } | null;
};

function hasCaseEvidence(result: Case, id: string) {
  if (result.dispute?.id !== id) return false;
  if (result.dispute.claimId === null) {
    const { report } = result;
    return !!report && Number.isInteger(report.version) && report.version >= 2 &&
      typeof report.summary === "string" && !!report.summary.trim() &&
      typeof report.limitations === "string" && !!report.limitations.trim() &&
      typeof report.approvedAt === "string" && Number.isFinite(Date.parse(report.approvedAt));
  }
  return typeof result.dispute.claimId === "string" && !!result.claim?.evidence;
}

export function ReviewDisputes({ close }: { close: () => void }) {
  const [after, setAfter] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [queue, setQueue] = useState<Queue>();
  const [current, setCurrent] = useState<Case>();
  const [resolution, setResolution] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attempt, reload] = useState(0);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setLoading(true);
    setQueue(undefined);
    setCurrent(undefined);
    setError("");
    setResolution("");
    async function load() {
      if (selected) {
        const result = await apiJson<Case>(`/qa/reviews/disputes/${selected}`, { signal });
        if (!result || !hasCaseEvidence(result, selected)) throw new Error("Missing dispute evidence.");
        if (!signal.aborted) setCurrent(result);
      } else {
        const cursor = after ? `?after=${encodeURIComponent(after)}` : "";
        const result = await apiJson<Queue>(`/qa/reviews/disputes${cursor}`, { signal });
        if (!result) throw new Error("Missing dispute queue.");
        if (!signal.aborted) setQueue(result);
      }
    }
    void load().catch(() => {
      if (!signal.aborted) setError("The dispute could not be loaded. Check your session and assignment access.");
    }).finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [after, selected, attempt]);

  const ready = !loading && selected && current && hasCaseEvidence(current, selected) ? current : undefined;

  async function decide(status: "IN_REVIEW" | "RESOLVED" | "REJECTED") {
    if (!ready || saving || error || (status !== "IN_REVIEW" && !resolution.trim())) return;
    const signal = request.current!.signal;
    const { dispute } = ready;
    setSaving(true);
    try {
      const result = await apiJson<{ dispute: Dispute }>(`/qa/reviews/disputes/${dispute.id}`, {
        method: "PATCH", signal, json: { status, expectedRevision: dispute.revision, resolution: status === "IN_REVIEW" ? undefined : resolution },
      });
      if (!result) throw new Error("Missing dispute response.");
      if (!signal.aborted) {
        setCurrent({ ...ready, dispute: result.dispute });
        setResolution("");
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiError && [401, 403, 404, 409].includes(error.status ?? 0)) setCurrent(undefined);
      setError("The decision could not be confirmed. Reload the dispute before retrying.");
    } finally {
      if (!signal.aborted) setSaving(false);
    }
  }

  return <main className="container page-heading">
    <h1>Review disputes</h1>
    <Button variant="secondary" disabled={saving} onClick={close}>Back to review quality assurance</Button>
    {selected && <Button variant="secondary" disabled={saving} onClick={() => { setCurrent(undefined); setSelected(undefined); }}>Back to disputes</Button>}
    {loading && <p role="status">Loading disputes…</p>}
    {saving && <p role="status">Saving decision…</p>}
    {error && <><Notice title="Dispute request failed" tone="error">{error}</Notice>
      <Button variant="quiet" onClick={() => reload(value => value + 1)}>Reload</Button></>}
    {queue && <>
      {queue.disputes.length === 0 && <p>No open disputes are available.</p>}
      <ul>{queue.disputes.map(dispute => <li key={dispute.id}>
        <Button variant="quiet" onClick={() => { setQueue(undefined); setSelected(dispute.id); }}>Open dispute {dispute.id}</Button>
        {" "}{dispute.status.replace("_", " ").toLowerCase()}
      </li>)}</ul>
      {after && <Button variant="secondary" onClick={() => setAfter(undefined)}>First page</Button>}
      {queue.nextCursor && <Button variant="secondary" onClick={() => setAfter(queue.nextCursor ?? undefined)}>Next page</Button>}
    </>}
    {ready && <section>
      <h2>Dispute for review {ready.reviewId}</h2>
      <p role="status">{ready.dispute.status.replace("_", " ").toLowerCase()}</p>
      <h3>Member reason</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{ready.dispute.reason}</p>
      {ready.report && <>
        <h3>Approved report</h3>
        <p>Version {ready.report.version}, approved <time dateTime={ready.report.approvedAt}>
          {new Date(ready.report.approvedAt).toLocaleDateString()}
        </time></p>
        <h4>Summary</h4>
        <p style={{ whiteSpace: "pre-wrap" }}>{ready.report.summary}</p>
        <h4>Limitations</h4>
        <p style={{ whiteSpace: "pre-wrap" }}>{ready.report.limitations}</p>
      </>}
      {ready.claim && <>
        <h3>{ready.claim.statement}</h3>
        <p>Source time range {ready.claim.evidence.startMs}–{ready.claim.evidence.endMs} ms</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{ready.claim.evidence.context}</p>
        {ready.claim.evidence.transcript && <blockquote style={{ whiteSpace: "pre-wrap" }}>{ready.claim.evidence.transcript}</blockquote>}
      </>}
      {ready.dispute.resolution && <><h3>Response to member</h3><p style={{ whiteSpace: "pre-wrap" }}>{ready.dispute.resolution}</p></>}
      {ready.dispute.status === "OPEN" &&
        <Button disabled={saving || !!error} onClick={() => void decide("IN_REVIEW")}>Start review</Button>}
      {ready.dispute.status === "IN_REVIEW" && <>
        <p><label>Response to member<br />
          <textarea value={resolution} maxLength={2000} disabled={saving} onChange={event => setResolution(event.target.value)} />
        </label></p>
        <Button disabled={saving || !!error || !resolution.trim()} onClick={() => void decide("RESOLVED")}>Uphold dispute</Button>
        <Button variant="secondary" disabled={saving || !!error || !resolution.trim()} onClick={() => void decide("REJECTED")}>Reject dispute</Button>
      </>}
    </section>}
  </main>;
}
