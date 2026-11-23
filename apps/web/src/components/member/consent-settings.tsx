"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import { ConsentSnapshot, memberErrorMessage, memberErrors, PublishedPolicies, Purpose, purposeLabels, purposes, readConsents, readPublishedPolicies } from "@/lib/member-contracts";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
import { Button } from "../ui/button";
import { Checkbox, Select } from "../ui/form";
import { Card } from "../ui/card";
import { LoadingState, Notice } from "../ui/status";

type Mutation = { key: string; purpose: Purpose; granted: boolean; body: { expectedVersion: number;
  consents: { purpose: Purpose; granted: boolean; policyVersion?: string; locale?: string; policyDigest?: string }[] } };
export function ConsentSettings({ publishedPolicies }: { publishedPolicies?: PublishedPolicies }) {
  const [locale, setLocale] = useState<"en" | "vi">("en");
  const [policies, setPolicies] = useState<PublishedPolicies>(publishedPolicies ?? {});
  const [policyLoading, setPolicyLoading] = useState(false), [policyError, setPolicyError] = useState<unknown>();
  const policyWait = useRetryAfter();
  async function loadPolicies(signal?: AbortSignal) {
    setPolicyLoading(true); setPolicies({}); setAccepted({}); setPolicyError(undefined);
    try {
      const next = await readPublishedPolicies(await apiJson(`/consents/policies?locale=${locale}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }), locale);
      if (!signal?.aborted) setPolicies(next);
    } catch (failure) {
      if (!signal?.aborted) { setPolicyError(failure); policyWait.fromError(failure);
        if (failure instanceof ApiError && [401,403].includes(failure.status ?? 0)) { setError(failure); setFresh(false); }
      }
    } finally { if (!signal?.aborted) setPolicyLoading(false); }
  }
  useEffect(() => {
    if (publishedPolicies !== undefined) { setPolicies(publishedPolicies); return; }
    const controller = new AbortController(); void loadPolicies(controller.signal); return () => controller.abort();
  }, [locale, publishedPolicies]);
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
    const reconciling = pending?.key === operation.key;
    setBusy(true); setError(undefined); setMessage("");
    try {
      // A new key is generated only by a new explicit action. Reconciliation reuses this exact object.
      readConsents(await apiJson("/consents/me", { method: "PATCH", json: operation.body,
        headers: { "Idempotency-Key": operation.key }, signal: AbortSignal.timeout(15000) }));
      setPending(undefined); setFresh(false); setAccepted({});
      const confirmed = await load();
      setMessage(confirmed ? "Request recorded. The current consent choices are shown below."
        : "Request recorded, but current choices could not be confirmed. Refresh before relying on the displayed state.");
    } catch (failure) {
      setError(failure); (operation.granted ? grantWait : revokeWait).fromError(failure);
      setAccepted({});
      if (reconciling && !(failure instanceof ApiError && failure.status === 429)) setPending(undefined);
      if (failure instanceof ApiError && failure.status === 409) { setConflict(true); setFresh(false); }
      if (!(failure instanceof ApiError) || failure.kind !== "http" || (failure.status ?? 0) >= 500) {
        setPending(operation); setFresh(false);
      }
    } finally { setBusy(false); }
  }
  function mutate(purpose: Purpose, granted: boolean) {
    if (!snapshot || busy || conflict) return;
    const policy = policies[purpose];
    if (granted && (!fresh || pending || !policy || !accepted[purpose] || grantWait.seconds)) return;
    if (!granted && revokeWait.seconds) return;
    if (pending?.purpose === purpose && pending.granted === granted) return;
    const item = granted ? { purpose, granted, policyVersion: policy!.version, ...(policy!.digest ? { locale: policy!.locale, policyDigest: policy!.digest } : {}) } : { purpose, granted };
    void send({ key: crypto.randomUUID(), purpose, granted, body: { expectedVersion: snapshot.version, consents: [item] } });
  }
  const denied = error instanceof ApiError && [401, 403].includes(error.status ?? 0);
  const errors = memberErrors(error, ["consents.0.policyVersion", "consents.0.purpose", "consents.0.granted", "expectedVersion"]);
  return <div className="stack">
    <Notice title="Each consent is independent.">Saving a profile never grants consent. Withdrawals do not require a new policy. Existing playback links may remain usable until expiry; withdrawal does not promise immediate physical deletion.</Notice>
    {publishedPolicies === undefined && <div className="stack">
      <Select name="policy-locale" label="Consent notice language" value={locale} disabled={busy || !!pending || policyLoading || policyWait.seconds > 0} onChange={event => { setPolicies({}); setAccepted({}); setLocale(event.target.value as "en" | "vi"); }}>
        <option value="en">English</option><option value="vi">Tiếng Việt</option>
      </Select>
      {policyLoading && <LoadingState label="Loading approved consent notices…" />}
      {policyError !== undefined && <Notice tone="error" title="Consent notices could not be verified.">Grants are unavailable until the current notices can be loaded. You can still withdraw an existing choice.</Notice>}
      <RetryAfterFeedback seconds={policyWait.seconds} id="consent-policy-retry" />
      <Button variant="secondary" disabled={busy || !!pending || policyLoading || policyWait.seconds > 0} onClick={() => void loadPolicies()}>Refresh consent notices</Button>
    </div>}
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
      const policy = policies[purpose];
      return <Card key={purpose} className="stack" role="group" aria-labelledby={`consent-${purpose}`}>
        <h2 id={`consent-${purpose}`}>{purposeLabels[purpose]}</h2>
        <p>{fresh ? "Current choice" : "Last known choice (refresh to confirm)"}: <strong>{state.granted ? "ON" : "OFF"}</strong></p>
        {!policy ? <p>Grant unavailable: no approved policy is currently available in this language.</p> : <>
          <details><summary>Read policy {policy.version} ({policy.locale})</summary><p className="consent-policy" lang={policy.locale}>{policy.content}</p></details>
          {policy.dependencies && policy.dependencies.length > 0 && <p>This feature also needs: {policy.dependencies.map(p => purposeLabels[p]).join(", ")}. Each choice stays separate.</p>}
          <Checkbox name={`agree-${purpose}`} label={`I agree to the displayed ${purposeLabels[purpose].toLowerCase()} policy.`}
            checked={accepted[purpose] ?? false} disabled={busy || loading || !fresh || conflict || !!pending}
            onChange={event => setAccepted(previous => ({ ...previous, [purpose]: event.target.checked }))} />
        </>}
        <div className="inline">
          <Button disabled={busy || loading || !fresh || conflict || !!pending || !policy || !accepted[purpose] || grantWait.seconds > 0}
            onClick={() => mutate(purpose, true)}>Grant {purposeLabels[purpose].toLowerCase()}</Button>
          <Button variant="secondary" disabled={busy || loading || conflict || revokeWait.seconds > 0 || (pending?.purpose === purpose && !pending.granted)}
            onClick={() => mutate(purpose, false)}>Withdraw {purposeLabels[purpose].toLowerCase()}</Button>
        </div>
      </Card>;
    })}
  </div>;
}
