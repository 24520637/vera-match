"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import { ConsentSnapshot, memberErrorMessage, memberErrors, PublishedPolicies, Purpose, purposeLabels, purposes, readConsents } from "@/lib/member-contracts";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/form";
import { Card } from "../ui/card";
import { LoadingState, Notice } from "../ui/status";

type Mutation = { key: string; purpose: Purpose; granted: boolean; body: { expectedVersion: number;
  consents: { purpose: Purpose; granted: boolean; policyVersion?: string }[] } };
export function ConsentSettings({ publishedPolicies }: { publishedPolicies: PublishedPolicies }) {
  const [snapshot, setSnapshot] = useState<ConsentSnapshot>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [fresh, setFresh] = useState(false);
  const [error, setError] = useState<unknown>(), [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState<Partial<Record<Purpose, boolean>>>({});
  const [pending, setPending] = useState<Mutation>(), [conflict, setConflict] = useState(false);
  const readWait = useRetryAfter(), grantWait = useRetryAfter(), revokeWait = useRetryAfter();
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  async function load(signal?: AbortSignal) {
    setLoading(true); setFresh(false);
    try {
      const next = readConsents(await apiJson("/consents/me", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }));
      if (signal?.aborted) return false;
      setSnapshot(next); setFresh(true); setError(undefined); setConflict(false); setAccepted({}); return true;
    } catch (failure) {
      if (signal?.aborted) return false;
      setError(failure); readWait.fromError(failure); return false;
    } finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  async function send(operation: Mutation) {
    if (busy) return;
    setBusy(true); setError(undefined); setMessage(""); setPending(undefined);
    try {
      // A new key is generated only by a new explicit action. Reconciliation reuses this exact object.
      readConsents(await apiJson("/consents/me", { method: "PATCH", json: operation.body,
        headers: { "Idempotency-Key": operation.key }, signal: AbortSignal.timeout(15000) }));
      setFresh(false); setAccepted({});
      const confirmed = await load();
      setMessage(confirmed ? "Request recorded. The current consent choices are shown below."
        : "Request recorded, but current choices could not be confirmed. Refresh before relying on the displayed state.");
    } catch (failure) {
      setError(failure); (operation.granted ? grantWait : revokeWait).fromError(failure);
      setAccepted({});
      if (failure instanceof ApiError && failure.status === 409) { setConflict(true); setFresh(false); }
      if (!(failure instanceof ApiError) || failure.kind !== "http" || (failure.status ?? 0) >= 500) {
        setPending(operation); setFresh(false);
      }
    } finally { setBusy(false); }
  }
  function mutate(purpose: Purpose, granted: boolean) {
    if (!snapshot || busy || conflict) return;
    const policy = publishedPolicies[purpose];
    if (granted && (!fresh || pending || !policy || !accepted[purpose] || grantWait.seconds)) return;
    if (!granted && revokeWait.seconds) return;
    const item = granted ? { purpose, granted, policyVersion: policy!.version } : { purpose, granted };
    void send({ key: crypto.randomUUID(), purpose, granted, body: { expectedVersion: snapshot.version, consents: [item] } });
  }
  const denied = error instanceof ApiError && [401, 403].includes(error.status ?? 0);
  const errors = memberErrors(error, ["consents.0.policyVersion", "consents.0.purpose", "consents.0.granted", "expectedVersion"]);
  return <div className="stack">
    <Notice title="Each consent is independent.">Saving a profile never grants consent. Withdrawals do not require a new policy. Existing playback links may remain usable until expiry; withdrawal does not promise immediate physical deletion.</Notice>
    {loading && <LoadingState label="Loading your consent choices…" />}
    {error !== undefined && <div ref={summary} id="consent-summary" tabIndex={-1}><Notice tone="error" title={memberErrorMessage(error)}>
      {Object.entries(errors).map(([field, text]) => <p key={field}>{text}</p>)}
      {error instanceof ApiError && error.status === 401 && <Link href="/login?next=%2Faccount%2Fconsents">Sign in</Link>}
    </Notice></div>}
    {message && <Notice title={message} tone={fresh ? "success" : "warning"} />}
    {conflict && <Notice tone="warning" title="Refresh and review your current choices.">Your earlier action was not automatically resubmitted. After refreshing, choose grant or withdrawal again explicitly.</Notice>}
    <RetryAfterFeedback seconds={readWait.seconds} id="consent-read-retry" />
    <Button variant="secondary" disabled={busy || loading || readWait.seconds > 0} onClick={() => void load()}>Refresh current consents</Button>
    {pending && <Notice tone="warning" title="The outcome of your request is uncertain.">
      <p>No success is assumed. You can refresh current consents, or explicitly reconcile the original {pending.granted ? "grant" : "withdrawal"} request. Reconciliation may apply it if it was not recorded; it uses the original key and version.</p>
      <Button variant="secondary" disabled={busy || (pending.granted ? grantWait.seconds > 0 : revokeWait.seconds > 0)} onClick={() => void send(pending)}>Reconcile original request</Button>
    </Notice>}
    <RetryAfterFeedback seconds={grantWait.seconds} id="consent-grant-retry" />
    <RetryAfterFeedback seconds={revokeWait.seconds} id="consent-revoke-retry" />
    {!snapshot && !loading && <p>Consent state is unavailable. Refresh to check it; nothing is assumed to be granted or withdrawn.</p>}
    {snapshot && !denied && purposes.map(purpose => {
      const state = snapshot.consents.find(item => item.purpose === purpose)!;
      const policy = publishedPolicies[purpose];
      return <Card key={purpose} className="stack" role="group" aria-labelledby={`consent-${purpose}`}>
        <h2 id={`consent-${purpose}`}>{purposeLabels[purpose]}</h2>
        <p>{fresh ? "Current choice" : "Last known choice (refresh to confirm)"}: <strong>{state.granted ? "ON" : "OFF"}</strong></p>
        {!policy ? <p>Grant unavailable: no approved policy has been published for this purpose.</p> : <>
          <details><summary>Read policy {policy.version} ({policy.locale})</summary><p className="consent-policy">{policy.content}</p></details>
          <Checkbox name={`agree-${purpose}`} label={`I agree to the displayed ${purposeLabels[purpose].toLowerCase()} policy.`}
            checked={accepted[purpose] ?? false} disabled={busy || loading || !fresh || conflict || !!pending}
            onChange={event => setAccepted(previous => ({ ...previous, [purpose]: event.target.checked }))} />
        </>}
        <div className="inline">
          <Button disabled={busy || loading || !fresh || conflict || !!pending || !policy || !accepted[purpose] || grantWait.seconds > 0}
            onClick={() => mutate(purpose, true)}>Grant {purposeLabels[purpose].toLowerCase()}</Button>
          <Button variant="secondary" disabled={busy || loading || conflict || revokeWait.seconds > 0}
            onClick={() => mutate(purpose, false)}>Withdraw {purposeLabels[purpose].toLowerCase()}</Button>
        </div>
      </Card>;
    })}
  </div>;
}
