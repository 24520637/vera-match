"use client";

import { useEffect, useState } from "react";
import { ApiError, apiJson } from "@/lib/api";
import { useAuth } from "../auth/auth-provider";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";
import { Notice } from "../ui/status";
import { MemberSettingsNav } from "./member-settings";

type Claim = {
  id: string;
  statement: string;
  evidence: { startMs: number; endMs: number; transcript: string | null; context: string };
  ownerConfirmed: boolean;
  shareApproved: boolean;
  revokedAt: string | null;
  revision: number;
};
type FeedbackTarget = "TRANSCRIPT" | "CONTEXT";
type ClaimFeedback = { target: FeedbackTarget; note: string; revision: number; updatedAt: string };
type ReportClaimData = Claim & { feedback: ClaimFeedback[] };
type Dispute = { id: string; claimId: string | null; reason: string; status: string; resolution: string | null; createdAt: string };

type Report = {
  id: string;
  summary: string;
  limitations: string;
  approvedAt: string;
  reviewer: string | null;
  source: { videoId: string; uploadedAt: string };
  claims: ReportClaimData[];
  disputes: Dispute[];
};
type ReportPage = { reports: Report[]; nextCursor: string | null };

export function MemberReviewReports() {
  const { state } = useAuth();
  if (state.status === "checking") return <p role="status">Checking your session…</p>;
  if (state.status !== "authenticated" || state.user.role !== "MEMBER")
    return <Notice title="Review reports unavailable">Sign in with an authorized member session.</Notice>;
  return <Reports key={state.user.id} />;
}

function Reports() {
  const [after, setAfter] = useState<string>();
  const [page, setPage] = useState<ReportPage>();
  const [error, setError] = useState("");
  const [attempt, reload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    void apiJson<ReportPage>(`/reviews/me${query}`, { signal }).then(result => {
      if (signal.aborted) return;
      if (!result) throw new Error("Missing report response.");
      setPage(result);
    }).catch(error => {
      if (signal.aborted) return;
      setError(error instanceof ApiError && [401, 403].includes(error.status ?? 0)
        ? "Check your session before opening your reports."
        : "Reports could not be loaded. Try again.");
    });
    return () => controller.abort();
  }, [after, attempt]);

  function changePage(cursor?: string) {
    setPage(undefined);
    setError("");
    setAfter(cursor);
    reload(value => value + 1);
  }

  return <>
    <MemberSettingsNav />
    <div className="container page-heading">
      <h1>Your review reports</h1>
      {!page && !error && <p role="status">Loading your reports…</p>}
      {error && <>
        <Notice title="Reports unavailable" tone="error">{error}</Notice>
        <Button onClick={() => changePage(after)}>Try again</Button>
      </>}
      {page && <>
        {page.reports.length === 0 && <p>No approved review reports are available.</p>}
        {page.reports.map(report => <article key={report.id} className="section">
          <h2>Video review approved on <time dateTime={report.approvedAt}>{new Date(report.approvedAt).toLocaleDateString()}</time></h2>
          <p>Independent quality review completed.</p>
          <dl>
            <dt>Reviewer</dt>
            <dd>{report.reviewer || "Assigned human reviewer"}</dd>
            <dt>Source</dt>
            <dd>Private video {report.source.videoId}, uploaded <time dateTime={report.source.uploadedAt}>{new Date(report.source.uploadedAt).toLocaleDateString()}</time></dd>
          </dl>
          <h3>Summary</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{report.summary}</p>
          <h3>Limitations and uncertainty</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{report.limitations}</p>
          {report.claims.length > 0 && <section>
            <h3>Factual claims</h3>
            {report.claims.map(claim => <ReportClaim key={claim.id} initial={claim} reload={() => changePage(after)} />)}
          </section>}
          <ReportDisputes report={report} reload={() => changePage(after)} />
        </article>)}
        {after && <Button variant="secondary" onClick={() => changePage()}>First page</Button>}
        {page.nextCursor && <Button variant="secondary" onClick={() => changePage(page.nextCursor ?? undefined)}>Next page</Button>}
      </>}
    </div>
  </>;
}

function ReportDisputes({ report, reload }: { report: Report; reload: () => void }) {
  const [disputes, setDisputes] = useState(report.disputes);
  const [reason, setReason] = useState("");
  const [claimId, setClaimId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = disputes.some(dispute => dispute.status === "OPEN" || dispute.status === "IN_REVIEW");

  async function submit() {
    if (saving || active || !reason.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await apiJson<{ dispute: Dispute }>(`/reviews/${report.id}/disputes`, {
        method: "POST", json: { reason, claimId: claimId || undefined },
      });
      if (!response) throw new Error("Missing dispute response.");
      setDisputes(current => [response.dispute, ...current]);
      setReason("");
      setClaimId("");
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0)) reload();
      else setError("The dispute could not be confirmed. Reload the report before retrying.");
    } finally {
      setSaving(false);
    }
  }

  return <section>
    <h3>Disputes</h3>
    {disputes.length > 0 && <ul>{disputes.map(dispute => <li key={dispute.id}>
      <p>{dispute.status.replace("_", " ").toLowerCase()} · <time dateTime={dispute.createdAt}>{new Date(dispute.createdAt).toLocaleDateString()}</time></p>
      <p>{report.claims.find(claim => claim.id === dispute.claimId)?.statement ?? "Entire report"}</p>
      <p style={{ whiteSpace: "pre-wrap" }}>{dispute.reason}</p>
      {dispute.resolution && <p style={{ whiteSpace: "pre-wrap" }}>Moderator response: {dispute.resolution}</p>}
    </li>)}</ul>}
    {!active && <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {report.claims.length > 0 && <p><label>Dispute concerns<br />
        <select value={claimId} disabled={saving} onChange={event => setClaimId(event.target.value)}>
          <option value="">Entire report</option>
          {report.claims.map(claim => <option key={claim.id} value={claim.id}>{claim.statement}</option>)}
        </select>
      </label></p>}
      <p><label>Why are you disputing this?<br />
        <textarea value={reason} required maxLength={2000} disabled={saving} onChange={event => setReason(event.target.value)} />
      </label></p>
      <Button type="submit" disabled={!reason.trim() || !!error} loading={saving}>Submit dispute</Button>
    </form>}
    {error && <><p role="alert">{error}</p><Button variant="secondary" onClick={reload}>Reload report</Button></>}
  </section>;
}

function ReportClaim({ initial, reload }: { initial: ReportClaimData; reload: () => void }) {
  const [claim, setClaim] = useState<Claim>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  async function update(action: "CONFIRM" | "SHARE" | "REVOKE") {
    setSaving(true);
    setError("");
    setConfirmRevoke(false);
    try {
      const response = await apiJson<{ claim: Claim }>(`/reviews/claims/${claim.id}`, {
        method: "PATCH", json: { action, expectedRevision: claim.revision },
      });
      if (!response) throw new Error("Missing claim response.");
      setClaim(response.claim);
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONSENT_REQUIRED")
        setError("Enable profile matching, report sharing, and video claim matching in your consent settings before sharing this claim.");
      else if (error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0)) reload();
      else setError("The claim could not be updated. Reload the report before retrying.");
    } finally {
      setSaving(false);
    }
  }

  return <article>
    <h4>{claim.statement}</h4>
    <p>Source time range {claim.evidence.startMs}–{claim.evidence.endMs} ms</p>
    <p style={{ whiteSpace: "pre-wrap" }}>{claim.evidence.context}</p>
    {claim.evidence.transcript && <blockquote style={{ whiteSpace: "pre-wrap" }}>{claim.evidence.transcript}</blockquote>}
    <details>
      <summary>Annotate this claim’s evidence</summary>
      <ClaimFeedbackForm claimId={claim.id} target="CONTEXT" initial={initial.feedback.find(note => note.target === "CONTEXT")} reload={reload} />
      {claim.evidence.transcript && <ClaimFeedbackForm claimId={claim.id} target="TRANSCRIPT"
        initial={initial.feedback.find(note => note.target === "TRANSCRIPT")} reload={reload} />}
    </details>
    <p role="status">{claim.revokedAt ? "Revoked" : claim.shareApproved ? "Sharing approved for matching" :
      claim.ownerConfirmed ? "Confirmed · not shared" : "Awaiting your confirmation"}</p>
    {!claim.revokedAt && <div>
      {!claim.ownerConfirmed && <Button disabled={saving || !!error} onClick={() => void update("CONFIRM")}>Confirm this claim</Button>}
      {claim.ownerConfirmed && !claim.shareApproved &&
        <Button disabled={saving || !!error} onClick={() => void update("SHARE")}>Share this claim for matching</Button>}
      <Button variant="secondary" disabled={saving || !!error} onClick={() => setConfirmRevoke(true)}>Revoke this claim</Button>
    </div>}
    {saving && <p role="status">Updating claim…</p>}
    <Modal open={confirmRevoke} onOpenChange={setConfirmRevoke} title="Revoke this claim?"
      description="This claim will be permanently excluded from matching. Its evidence will remain visible in your private report.">
      <Button variant="secondary" onClick={() => setConfirmRevoke(false)}>Keep claim</Button>
      <Button onClick={() => void update("REVOKE")}>Confirm revocation</Button>
    </Modal>
    {error && <><p role="alert">{error}</p><Button variant="secondary" onClick={reload}>Reload report</Button></>}
  </article>;
}

function ClaimFeedbackForm({ claimId, target, initial, reload }: {
  claimId: string; target: FeedbackTarget; initial?: ClaimFeedback; reload: () => void;
}) {
  const [feedback, setFeedback] = useState(initial);
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const subject = target === "CONTEXT" ? "context" : "transcript";
  const changed = Boolean(note.trim() && note.trim() !== feedback?.note);

  async function submit() {
    if (saving || stale || !changed) return;
    setSaving(true);
    setError("");
    try {
      const response = await apiJson<{ feedback: ClaimFeedback }>(`/reviews/claims/${claimId}/feedback`, {
        method: "PATCH", json: { target, note, expectedRevision: feedback?.revision ?? 0 },
      });
      if (!response) throw new Error("Missing feedback response.");
      setFeedback(response.feedback);
      setNote(response.feedback.note);
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0)) reload();
      else if (error instanceof ApiError && error.status === 409) {
        setStale(true);
        setError("This annotation changed. Reload the report to see the saved version.");
      } else setError("Feedback could not be confirmed. Try saving it again.");
    } finally {
      setSaving(false);
    }
  }

  return <form onSubmit={event => { event.preventDefault(); void submit(); }}>
    <p><label>Private feedback on the {subject}<br />
      <textarea value={note} required maxLength={2000} disabled={saving || stale} onChange={event => setNote(event.target.value)} />
    </label></p>
    <Button type="submit" disabled={!changed || stale} loading={saving}>Save {subject} feedback</Button>
    {feedback && note.trim() === feedback.note &&
      <p role="status">{subject === "context" ? "Context" : "Transcript"} feedback saved.</p>}
    {error && <p role="alert">{error}</p>}
    {stale && <Button variant="secondary" onClick={reload}>Reload report</Button>}
  </form>;
}
