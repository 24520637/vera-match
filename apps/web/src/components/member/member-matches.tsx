"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiJson } from "@/lib/api";
import { useAuth } from "../auth/auth-provider";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
import { useRetryAfter } from "../auth/use-retry-after";
import { PageHeader } from "../layout/page-layout";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState, LoadingState, Notice } from "../ui/status";
import { MemberSettingsNav } from "./member-settings";
import "./dating.css";

type Choice = "ACCEPT" | "DECLINE";
type Recommendation = { key: string; pairId: string; reasons: string[] };
type Decision = { id: string; choice: Choice; createdAt: string; available: boolean; mutual: boolean; connectionId?: string | null };
type Recommendations = { available: boolean; recommendations: Recommendation[]; nextCursor: string | null };
type History = { decisions: Decision[]; nextCursor: string | null };
type Load<T> = { kind: "loading" } | { kind: "error"; error: unknown } | { kind: "ready"; data: T };
type NoticeData = { tone: "success" | "warning" | "error"; message: string };

function hasFields(value: unknown, ...fields: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function isReference(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,768}$/.test(value);
}

function isRecommendations(value: unknown): value is Recommendations {
  if (!hasFields(value, "available", "recommendations", "nextCursor") || typeof value.available !== "boolean" ||
    !Array.isArray(value.recommendations) || (value.nextCursor !== null && !isReference(value.nextCursor))) return false;
  if (!value.available) return value.recommendations.length === 0 && value.nextCursor === null;
  return value.recommendations.every((item: unknown) => hasFields(item, "key", "pairId", "reasons") &&
    isReference(item.key) && isReference(item.pairId) && Array.isArray(item.reasons) &&
    item.reasons.every((reason: unknown) => typeof reason === "string"));
}

function isHistory(value: unknown): value is History {
  if (!hasFields(value, "decisions", "nextCursor") || !Array.isArray(value.decisions) ||
    (value.nextCursor !== null && !isReference(value.nextCursor))) return false;
  return value.decisions.every((item: unknown) => hasFields(item, "id", "choice", "createdAt", "available", "mutual",
      ...(item && typeof item === "object" && Object.hasOwn(item, "connectionId") ? ["connectionId"] : [])) &&
    isReference(item.id) && (item.choice === "ACCEPT" || item.choice === "DECLINE") &&
    typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) &&
    new Date(item.createdAt).toISOString() === item.createdAt &&
    typeof item.available === "boolean" && typeof item.mutual === "boolean" &&
    (item.connectionId === undefined || item.connectionId === null || isReference(item.connectionId)) &&
    (!item.mutual || (item.available && item.choice === "ACCEPT")));
}

function requestError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Sign in again to see your matches.";
    if (error.status === 403) return "Your account cannot access matches.";
    if (error.status === 429) return error.retryAfterSeconds
      ? `Try again in ${error.retryAfterSeconds} seconds.`
      : "Wait a moment before trying again.";
  }
  return "Matching could not be loaded. Try again.";
}

function useMatchPage<T>(path: string, isPage: (value: unknown) => value is T) {
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  const active = useRef<AbortController | null>(null);
  const load = useCallback((after?: string) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ kind: "loading" });
    const url = after ? `${path}?after=${encodeURIComponent(after)}` : path;
    void apiJson<unknown>(url, { signal: controller.signal }).then(
      (data) => {
        if (controller.signal.aborted) return;
        setState(isPage(data) ? { kind: "ready", data }
          : { kind: "error", error: new ApiError("invalid-response", "Invalid matching response.") });
      },
      (error: unknown) => { if (!controller.signal.aborted) setState({ kind: "error", error }); },
    );
  }, [isPage, path]);
  const clear = useCallback(() => {
    active.current?.abort();
    setState({ kind: "loading" });
  }, []);
  useEffect(() => {
    load();
    return () => active.current?.abort();
  }, [load]);
  return { state, load, clear };
}

function decisionMessage(error: unknown): NoticeData {
  if (error instanceof ApiError) {
    if (error.status === 404) return { tone: "warning", message: "This recommendation is no longer available." };
    if (error.status === 409) return { tone: "warning", message: "A different choice was already recorded." };
    if (error.status === 401 || error.status === 403 || error.status === 429)
      return { tone: "error", message: requestError(error) };
  }
  return { tone: "error", message: "Your choice could not be confirmed. Check decision history before trying again." };
}

function MatchesScreen() {
  const { state: recommendations, load: loadRecommendations, clear: clearRecommendations } =
    useMatchPage("/matches/recommendations", isRecommendations);
  const { state: history, load: loadHistory, clear: clearHistory } = useMatchPage("/matches/decisions", isHistory);
  const [pending, setPending] = useState(false);
  const [view, setView] = useState<"discover" | "connections" | "all">("all");
  const decisionQuota = useRetryAfter();
  const decisionDisabled = pending || decisionQuota.seconds > 0;
  useEffect(() => {
    const followAnchor = () => { if (window.location.hash === "#connections") setView("connections"); };
    followAnchor();
    window.addEventListener("hashchange", followAnchor);
    return () => window.removeEventListener("hashchange", followAnchor);
  }, []);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const committing = useRef(false);
  const status = useRef<HTMLDivElement>(null);

  const refreshMatches = useCallback(() => {
    if (committing.current) return;
    loadRecommendations();
    loadHistory();
  }, [loadHistory, loadRecommendations]);

  useEffect(() => {
    const hide = () => {
      clearRecommendations();
      clearHistory();
    };
    const refresh = () => document.visibilityState === "hidden" ? hide() : refreshMatches();
    const restored = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", restored);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("pagehide", hide);
    };
  }, [clearHistory, clearRecommendations, refreshMatches]);

  async function decide(recommendation: Recommendation, choice: Choice) {
    if (committing.current || decisionDisabled) return;
    committing.current = true;
    setPending(true);
    setNotice(null);
    clearRecommendations();
    clearHistory();
    try {
      const result = await apiJson<{ choice: Choice; mutual: boolean }>(
        `/matches/${recommendation.pairId}/decision`, { method: "POST", json: { choice } },
      );
      if (!result || result.choice !== choice || typeof result.mutual !== "boolean" ||
        (choice === "DECLINE" && result.mutual)) throw new Error("Invalid decision receipt");
      setNotice({
        tone: "success",
        message: result.mutual ? "It’s a mutual match! Open your connection below to choose what to share." : choice === "ACCEPT" ? "Acceptance saved." : "Decline saved.",
      });
    } catch (error) {
      decisionQuota.fromError(error);
      setNotice(decisionMessage(error));
    } finally {
      committing.current = false;
      setPending(false);
      if (document.visibilityState === "visible") {
        refreshMatches();
        status.current?.focus();
      }
    }
  }

  return (
    <div className="container member-settings dating-workspace stack">
      <MemberSettingsNav />
      <PageHeader title="A little closer to someone new." description="Explore thoughtful introductions. A connection starts when you both say yes.">
        <Button variant="secondary" disabled={pending} onClick={refreshMatches}>Refresh matches</Button>
      </PageHeader>
      <div className="dating-path" aria-label="How connections work"><span>01 · Discover</span><span>02 · Both accept</span><span>03 · Share & talk</span></div>
      <div className="dating-tabs" role="group" aria-label="Match views">
        <Button variant={view === "discover" ? "primary" : "secondary"} aria-pressed={view === "discover"} onClick={() => setView("discover")}>Discover</Button>
        <Button variant={view === "connections" ? "primary" : "secondary"} aria-pressed={view === "connections"} onClick={() => setView("connections")}>Connections</Button>
        <Button variant={view === "all" ? "primary" : "secondary"} aria-pressed={view === "all"} onClick={() => setView("all")}>All activity</Button>
      </div>
      <div ref={status} tabIndex={-1}>
        {notice && <Notice tone={notice.tone} title={notice.message} />}
        {pending && <span role="status">Saving your choice…</span>}
        <RetryAfterFeedback id="matching-decision-retry" seconds={decisionQuota.seconds} />
      </div>
      <section hidden={view === "connections"} className="stack dating-discover" aria-labelledby="recommendations-heading">
        <h2 id="recommendations-heading">Recommendations</h2>
        <p className="muted">Start with what you have in common. Names and photos stay private until mutual acceptance and explicit sharing.</p>
        {recommendations.kind === "loading" && <LoadingState label="Loading recommendations…" />}
        {recommendations.kind === "error" &&
          <Notice tone="error" title={requestError(recommendations.error)}>
            <Button variant="secondary" onClick={() => loadRecommendations()}>Refresh recommendations</Button>
          </Notice>}
        {recommendations.kind === "ready" && !recommendations.data.available &&
          <EmptyState title="Recommendations unavailable">
            Review your <Link href="/account/profile">profile</Link>, <Link href="/account/preferences">preferences</Link>, and <Link href="/account/consents">matching consent</Link>.
          </EmptyState>}
        {recommendations.kind === "ready" && recommendations.data.available &&
          <>
            {recommendations.data.recommendations.length === 0 &&
              <EmptyState title="No recommendations on this page">
                {recommendations.data.nextCursor ? "Check the next page for more." : "Check again after updating your preferences."}
              </EmptyState>}
            {recommendations.data.recommendations.map((item, index) =>
              <Card key={item.key} className="dating-introduction">
                <div className="dating-introduction__art" aria-hidden="true">✦</div>
                <div className="dating-introduction__body">
                <span className="dating-eyebrow">A new possibility</span>
                <h3>Recommendation {index + 1}</h3>
                <p>A thoughtful introduction, at your pace.</p>
                <ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
                <div className="form-actions">
                  <Button aria-label="Accept" disabled={decisionDisabled} onClick={() => void decide(item, "ACCEPT")}>Accept · Interested</Button>
                  <Button aria-label="Decline" variant="secondary" disabled={decisionDisabled} onClick={() => void decide(item, "DECLINE")}>Decline · Pass</Button>
                </div>
                <p className="small muted">Accept means you’re interested. Your choice is final; contact details are never shared automatically.</p>
                </div>
              </Card>,
            )}
            {recommendations.data.nextCursor &&
              <Button variant="secondary" disabled={pending}
                onClick={() => loadRecommendations(recommendations.data.nextCursor ?? undefined)}>Next recommendations</Button>}
          </>}
      </section>
      <section id="connections" hidden={view === "discover"} className="stack dating-history" aria-labelledby="history-heading">
        <h2 id="history-heading">{view === "connections" ? "Your connections" : "Decision history"}</h2>
        <p className="muted">Your interests and connections. When you both accept, you can choose what to share and start chatting.</p>
        {history.kind === "loading" && <LoadingState label="Loading decision history…" />}
        {history.kind === "error" &&
          <Notice tone="error" title={requestError(history.error)}>
            <Button variant="secondary" onClick={() => loadHistory()}>Refresh decision history</Button>
          </Notice>}
        {history.kind === "ready" &&
          <>
            {!history.data.decisions.filter(d => view !== "connections" || d.mutual).length &&
              <EmptyState title={view === "connections" ? "Your next connection is ahead" : "No decisions on this page"}>{view === "connections" ? "A connection appears when you both accept. Explore Discover, or check older activity below." : "Your saved decisions appear here."}</EmptyState>}
            <ul>
              {history.data.decisions.filter(d => view !== "connections" || d.mutual).map(decision =>
                <li key={decision.id} className={`dating-decision ${decision.mutual ? "dating-decision--mutual" : ""}`}>
                  {decision.choice === "ACCEPT" ? "Accepted" : "Declined"}
                  {" · "}<time dateTime={decision.createdAt}>{new Date(decision.createdAt).toLocaleDateString()}</time>
                  {decision.mutual ? " · Mutual match" : decision.available ? "" : " · Unavailable"}
                  {decision.mutual && decision.available && decision.connectionId && (
                    <div className="form-actions">
                      <Link className="button button--secondary button--regular"
                        href={`/account/matches/${decision.connectionId}`}>View profile and chat</Link>
                    </div>
                  )}
                </li>,
              )}
            </ul>
            {history.data.nextCursor &&
              <Button variant="secondary" onClick={() => loadHistory(history.data.nextCursor ?? undefined)}>Older decisions</Button>}
          </>}
      </section>
    </div>
  );
}

export function MemberMatches() {
  const { state } = useAuth();
  if (state.status === "checking") return <LoadingState label="Checking your session…" />;
  if (state.status !== "authenticated")
    return <Notice tone="error" title="Session unavailable"><Link href="/login?next=%2Faccount%2Fmatches">Sign in</Link> to see your matches.</Notice>;
  if (state.user.role !== "MEMBER")
    return <Notice tone="error" title="Access denied">Matches are available to members.</Notice>;
  return <MatchesScreen key={state.user.id} />;
}
