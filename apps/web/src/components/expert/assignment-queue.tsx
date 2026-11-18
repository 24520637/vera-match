"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/auth-provider";
import { SessionUnavailable } from "../auth/session-boundary";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
import { PageHeader } from "../layout/page-layout";
import { Button } from "../ui/button";
import { Badge, EmptyState, LoadingState, Notice } from "../ui/status";
import { assignmentStatusLabels, queueFailure, validateQueueView,
  type AssignmentQueueLoader, type AssignmentQueuePage } from "@/lib/expert-queue-view";
import "./expert-queues.css";

export type AssignmentQueueRole = "EXPERT" | "MODERATOR";
export function AssignmentQueue({ role, loader }: { role: AssignmentQueueRole; loader?: AssignmentQueueLoader }) {
  const { state } = useAuth();
  const title = role === "EXPERT" ? "Your assignments" : "Assignment moderation";
  return <div className="container expert-queue">
    <PageHeader title={title} description={role === "EXPERT" ? "Review the status and work deadlines of your assigned jobs." : "Review assignment status and work deadlines. This is separate from Safety Reports."} />
    {state.status === "checking" ? <LoadingState label="Checking your session…" /> :
      state.status === "unavailable" || state.status === "forbidden" ? <SessionUnavailable denied={state.status === "forbidden"} /> :
      state.status !== "authenticated" ? <Notice title="Sign in required">Sign in to access assignments.</Notice> :
      state.user.role !== role ? <Notice tone="warning" title="Assignment access denied">This queue is available only to {role === "EXPERT" ? "experts" : "moderators"}. Other roles do not inherit access.</Notice> :
      <QueueContent key={`${state.user.id}:${role}`} loader={loader} />}
  </div>;
}

function QueueContent({ loader }: { loader?: AssignmentQueueLoader }) {
  const [page, setPage] = useState<AssignmentQueuePage>();
  const [loading, setLoading] = useState(false), [error, setError] = useState<unknown>();
  const request = useRef<AbortController | undefined>(undefined), sequence = useRef(0), alive = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null), retry = useRetryAfter();
  const load = useCallback(async (cursor: string | null = null) => {
    if (!loader) return;
    request.current?.abort();
    const controller = new AbortController(), current = ++sequence.current;
    request.current = controller;
    setLoading(true); setError(undefined);
    if (!cursor) setPage(undefined);
    try {
      const value = await loader({ cursor, signal: controller.signal });
      validateQueueView(value);
      if (cursor && value.nextCursor === cursor) throw new Error("Pagination did not advance");
      if (alive.current && current === sequence.current && !controller.signal.aborted) {
        setPage(previous => ({ items: cursor ? [...(previous?.items ?? []), ...value.items.filter(row => !previous?.items.some(old => old.id === row.id))] : value.items,
          nextCursor: value.nextCursor }));
        if (cursor) requestAnimationFrame(() => heading.current?.focus());
      }
    } catch (failure) {
      if (alive.current && current === sequence.current && !controller.signal.aborted) {
        setPage(undefined); setError(failure); retry.fromError(failure);
      }
    } finally {
      if (alive.current && current === sequence.current && !controller.signal.aborted) setLoading(false);
    }
  // Retry state is not a request dependency: countdown changes never resend reads.
  }, [loader]);
  useEffect(() => {
    alive.current = true; void load();
    return () => { alive.current = false; ++sequence.current; request.current?.abort(); };
  }, [load]);

  if (!loader) return <Notice title="Assignment queue unavailable">
    No server-backed queue adapter is configured for this view. No assignments have been loaded,
    and no assignment action has been submitted.
    <div className="form-actions"><Button disabled>Load assignments</Button></div>
  </Notice>;
  const failure = error ? queueFailure(error) : undefined;
  return <section aria-labelledby="assignment-queue-heading" aria-busy={loading}>
    <h2 id="assignment-queue-heading" ref={heading} tabIndex={-1}>Assignment queue</h2>
    <p>Due dates are work deadlines, not permission to access a video.</p>
    <div className="form-actions"><Button variant="secondary" disabled={loading || retry.seconds > 0} onClick={() => void load()}>Refresh assignments</Button></div>
    {failure && <Notice tone="error" title={failure.title}>{failure.message}</Notice>}
    <RetryAfterFeedback id="assignment-queue-retry" seconds={retry.seconds} />
    {loading && <LoadingState label={page ? "Loading more assignments…" : "Loading assignments…"} />}
    {page?.items.length === 0 && <EmptyState title="No assignments in this queue">No jobs were returned by the authorized queue. Refresh later.</EmptyState>}
    <ul className="expert-queue__rows" aria-label="Assignments">
      {page?.items.map(row => <li key={row.id}>
        <h3>Assignment <span translate="no">{row.id}</span></h3>
        <Badge>{assignmentStatusLabels[row.status]}</Badge>
        <p>Due: {row.dueAt === null ? "No deadline set" : <time dateTime={row.dueAt}>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(row.dueAt))} UTC</time>}</p>
      </li>)}
    </ul>
    {page?.nextCursor && <Button variant="secondary" disabled={loading || retry.seconds > 0} onClick={() => void load(page.nextCursor)}>Load more assignments</Button>}
  </section>;
}
