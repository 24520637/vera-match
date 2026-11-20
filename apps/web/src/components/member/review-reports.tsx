"use client";

import { useEffect, useState } from "react";
import { ApiError, apiJson } from "@/lib/api";
import { useAuth } from "../auth/auth-provider";
import { Button } from "../ui/button";
import { Notice } from "../ui/status";
import { MemberSettingsNav } from "./member-settings";

type Report = {
  id: string;
  summary: string;
  limitations: string;
  approvedAt: string;
  reviewer: string | null;
  source: { videoId: string; uploadedAt: string };
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
    <main className="container page-heading">
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
        </article>)}
        {after && <Button variant="secondary" onClick={() => changePage()}>First page</Button>}
        {page.nextCursor && <Button variant="secondary" onClick={() => changePage(page.nextCursor ?? undefined)}>Next page</Button>}
      </>}
    </main>
  </>;
}
