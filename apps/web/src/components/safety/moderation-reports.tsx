"use client";
import { useEffect, useRef, useState } from "react";
import { apiJson } from "@/lib/api";
import {
  reportReasons,
  reportStatuses,
  safetyMessage,
  type QueueReport,
  type ReportDetail,
  type ReportState,
} from "@/lib/safety-contracts";
import { useAuth } from "../auth/auth-provider";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
import { PageHeader } from "../layout/page-layout";
import { Button } from "../ui/button";
import { Select } from "../ui/form";
import { Modal } from "../ui/modal";
import { EmptyState, LoadingState, Notice } from "../ui/status";
import "./safety.css";
type Queue = { reports: QueueReport[]; nextCursor: string | null };
export function ModerationReports() {
  const { state } = useAuth();
  if (state.status === "checking")
    return <LoadingState label="Checking your session…" />;
  if (state.status !== "authenticated" || state.user.role !== "MODERATOR")
    return (
      <Notice tone="warning" title="Report access denied">
        This workspace is available only to authorized moderators.
      </Notice>
    );
  return <ReportQueue key={state.user.id} />;
}
function ReportQueue() {
  const [rows, setRows] = useState<QueueReport[]>(),
    [cursor, setCursor] = useState<string | null>(null),
    [filter, setFilter] = useState("");
  const [detail, setDetail] = useState<ReportDetail>(),
    [decision, setDecision] = useState<"RESOLVED" | "DISMISSED">();
  const [loading, setLoading] = useState(true),
    [working, setWorking] = useState(false),
    [error, setError] = useState<unknown>(),
    [message, setMessage] = useState("");
  const retry = useRetryAfter(),
    alive = useRef(true),
    seq = useRef(0),
    currentFilter = useRef(""),
    heading = useRef<HTMLHeadingElement>(null),
    safe = useRef<HTMLButtonElement>(null);
  async function load(append = false, status = currentFilter.current) {
    const current = ++seq.current;
    setLoading(true);
    setDetail(undefined);
    setDecision(undefined);
    setError(undefined);
    if (!append) {
      setRows(undefined);
      setCursor(null);
      currentFilter.current = status;
    }
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (append && cursor) params.set("cursor", cursor);
    try {
      const value = await apiJson<Queue>(
        "/moderation/reports" + (params.size ? "?" + params.toString() : ""),
      );
      if (!value) throw new Error("The report queue could not be loaded.");
      if (alive.current && current === seq.current) {
        setRows((previous) =>
          append
            ? [
                ...(previous ?? []),
                ...value.reports.filter(
                  (r) => !previous?.some((p) => p.id === r.id),
                ),
              ]
            : value.reports,
        );
        setCursor(value.nextCursor);
      }
    } catch (e) {
      if (alive.current && current === seq.current) {
        setError(e);
        setRows(undefined);
        setCursor(null);
        retry.fromError(e);
      }
    } finally {
      if (alive.current && current === seq.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      ++seq.current;
    };
  }, []);
  async function open(row: QueueReport) {
    if (working || retry.seconds) return;
    setWorking(true);
    setError(undefined);
    setMessage("");
    setDetail(undefined);
    try {
      if (row.status === "OPEN") {
        const result = await apiJson<{ report: QueueReport }>(
          "/moderation/reports/" + encodeURIComponent(row.id),
          {
            method: "PATCH",
            json: { expectedRevision: row.revision, status: "IN_REVIEW" },
          },
        );
        if (!result)
          throw new Error(
            "The claim could not be confirmed. Refresh the queue.",
          );
        if (alive.current)
          setRows((previous) =>
            previous?.map((r) =>
              r.id === row.id ? { ...r, ...result.report } : r,
            ),
          );
      }
      const value = await apiJson<{ report: ReportDetail }>(
        "/moderation/reports/" + encodeURIComponent(row.id),
      );
      if (!value) throw new Error("Report details could not be confirmed.");
      if (alive.current) {
        setDetail(value.report);
        requestAnimationFrame(() =>
          document.getElementById("report-detail-heading")?.focus(),
        );
      }
    } catch (e) {
      if (alive.current) {
        setError(e);
        setRows(undefined);
        setDetail(undefined);
        setCursor(null);
        retry.fromError(e);
      }
    } finally {
      if (alive.current) setWorking(false);
    }
  }
  async function finish() {
    if (!detail || !decision || working || retry.seconds) return;
    setWorking(true);
    setError(undefined);
    try {
      const result = await apiJson<{
        report: { status: ReportState; revision: number };
      }>("/moderation/reports/" + encodeURIComponent(detail.id), {
        method: "PATCH",
        json: { status: decision, expectedRevision: detail.revision },
      });
      if (!result)
        throw new Error(
          "The report status could not be confirmed. Refresh before retrying.",
        );
      if (alive.current) {
        setRows((previous) => previous?.filter((r) => r.id !== detail.id));
        setDetail(undefined);
        setDecision(undefined);
        setMessage(
          "Report marked " +
            reportStatuses[result.report.status].toLowerCase() +
            ".",
        );
        heading.current?.focus();
      }
    } catch (e) {
      if (alive.current) {
        setError(e);
        setRows(undefined);
        setDetail(undefined);
        setDecision(undefined);
        setCursor(null);
        retry.fromError(e);
      }
    } finally {
      if (alive.current) setWorking(false);
    }
  }
  return (
    <div className="container safety-workspace">
      <PageHeader
        title="Review reports"
        description="Claim a case before viewing its details. Every read and status change is audited."
      />
      <p>
        Access requires a current moderator session and verified staff
        assurance. Cases involving your own account are excluded.
      </p>
      <div className="form-actions">
        <Select
          id="report-filter"
          name="status"
          label="Report status"
          value={filter}
          disabled={working || loading}
          onChange={(e) => {
            setFilter(e.target.value);
            setCursor(null);
          }}
        >
          <option value="">Open and in review</option>
          {Object.entries(reportStatuses).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          disabled={working || loading || retry.seconds > 0}
          onClick={() => void load(false, filter)}
        >
          Refresh report queue
        </Button>
      </div>
      {!!error && (
        <Notice tone="error" title="Report access unavailable">
          {safetyMessage(error)} Refresh the queue before retrying an uncertain
          change.
        </Notice>
      )}
      {message && (
        <Notice tone="success" title="Review updated">
          {message}
        </Notice>
      )}
      <RetryAfterFeedback id="moderation-retry" seconds={retry.seconds} />
      {loading && !rows && <LoadingState label="Loading your report queue…" />}
      <h2 ref={heading} tabIndex={-1}>
        Report queue
      </h2>
      {rows?.length === 0 && (
        <EmptyState title="No reports in this queue">
          Try another status or refresh later.
        </EmptyState>
      )}
      <ul className="safety-list">
        {rows?.map((row) => (
          <li key={row.id}>
            <h3>
              {row.reasonCode
                ? reportReasons[row.reasonCode]
                : "Unclassified legacy concern"}
            </h3>
            <p>
              Reference: <span translate="no">{row.id}</span>
            </p>
            <p>
              {reportStatuses[row.status]} ·{" "}
              {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                new Date(row.createdAt),
              )}
            </p>
            <Button
              aria-label={
                (row.status === "OPEN" ? "Claim report " : "Open report ") +
                row.id
              }
              disabled={working || loading || retry.seconds > 0}
              onClick={() => void open(row)}
            >
              {row.status === "OPEN" ? "Claim report" : "Open report"}
            </Button>
          </li>
        ))}
      </ul>
      {cursor && (
        <Button
          variant="secondary"
          loading={loading}
          loadingLabel="Loading more reports…"
          disabled={working || retry.seconds > 0}
          onClick={() => void load(true)}
        >
          Load more reports
        </Button>
      )}
      {detail && (
        <section
          className="safety-section"
          aria-labelledby="report-detail-heading"
        >
          <h2 id="report-detail-heading" tabIndex={-1}>
            Claimed report
          </h2>
          <p>
            Reference: <span translate="no">{detail.id}</span>
          </p>
          <p>
            {detail.reason
              ? reportReasons[detail.reason]
              : "Unclassified legacy concern"}
            . {reportStatuses[detail.status]}.
          </p>
          <h3>Reported concern</h3>
          <p className="safety-details">{detail.details}</p>
          <p>Target reference: {detail.targetReference ?? "Mapping removed"}</p>
          <p>
            Reporter reference: {detail.reporterReference ?? "Mapping removed"}
          </p>
          {detail.status === "IN_REVIEW" && (
            <div className="form-actions">
              <Button
                disabled={working || retry.seconds > 0}
                onClick={() => setDecision("RESOLVED")}
              >
                Resolve report
              </Button>
              <Button
                variant="secondary"
                disabled={working || retry.seconds > 0}
                onClick={() => setDecision("DISMISSED")}
              >
                Dismiss report
              </Button>
            </div>
          )}
          <h3>Review history</h3>
          <ol>
            {detail.actions.map((a) => (
              <li key={a.revision}>
                {reportStatuses[a.fromStatus]} to {reportStatuses[a.toStatus]} —{" "}
                {new Intl.DateTimeFormat("en", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(a.createdAt))}
              </li>
            ))}
          </ol>
        </section>
      )}
      <Modal
        open={!!decision}
        onOpenChange={(open) => {
          if (!open && !working) setDecision(undefined);
        }}
        title={
          decision === "RESOLVED"
            ? "Resolve this report?"
            : "Dismiss this report?"
        }
        description="This closes your review of the report. Closed cases cannot be reopened in this build."
        dismissible={!working}
        initialFocusRef={safe}
      >
        <div className="form-actions">
          <Button
            ref={safe}
            variant="secondary"
            disabled={working}
            onClick={() => setDecision(undefined)}
          >
            Keep in review
          </Button>
          <Button
            variant="danger"
            loading={working}
            loadingLabel="Saving review…"
            disabled={retry.seconds > 0}
            onClick={() => void finish()}
          >
            Confirm {decision === "RESOLVED" ? "resolution" : "dismissal"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
