"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import { defaults, goals, interests, memberErrorMessage, memberErrors, priorities, questions, readResource, resourcePayload, Screen, Value, Values, valuesCatalog } from "@/lib/member-contracts";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
import { Button } from "../ui/button";
import { Checkbox, Fieldset, Form, FormActions, Input, Select, Textarea } from "../ui/form";
import { EmptyState, LoadingState, Notice } from "../ui/status";

const labels: Record<string, string> = { birthDate: "Birth date", occupation: "Occupation", city: "City", bio: "About you",
  relationshipGoal: "Relationship goal", interests: "Interests", values: "Values", visibilityEnabled: "Visible for matching",
  minAge: "Minimum age", maxAge: "Maximum age", dealBreakers: "Dealbreakers", priorities: "Priority order" };
export function ResourceEditor({ screen }: { screen: Exclude<Screen, "consents"> }) {
  const [draft, setDraft] = useState<Values>(() => defaults(screen));
  const [saved, setSaved] = useState<Values>();
  const [revision, setRevision] = useState<number>();
  const [dirty, setDirty] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [empty, setEmpty] = useState(false);
  const [error, setError] = useState<unknown>(), [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false), [review, setReview] = useState(false), [reviewed, setReviewed] = useState(false);
  const retry = useRetryAfter();
  const summary = useRef<HTMLDivElement>(null);
  const fieldNames = Object.keys(defaults(screen));
  const errors = memberErrors(error, fieldNames);
  useUnsavedChanges(dirty.length > 0, "Leave this page? Your unsaved changes will be lost.");
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  const load = useCallback(async (preserve = false, signal?: AbortSignal) => {
    setLoading(true); setSuccess(""); setSaved(undefined);
    try {
      const result = readResource(screen, await apiJson(`/${screen}/me`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }));
      if (signal?.aborted) return;
      setSaved(result.values); setRevision(result.revision); setEmpty(result.empty); setError(undefined);
      if (!preserve) { setDraft(result.values); setDirty([]); }
      setConflict(false); setReview(preserve); setReviewed(false);
    } catch (failure) {
      if (signal?.aborted) return;
      setError(failure); retry.fromError(failure);
      if (failure instanceof ApiError && failure.code === "DATA_SHAPE_UNAVAILABLE" && failure.resourceRevision !== undefined) {
        setRevision(failure.resourceRevision); setEmpty(false);
        if (preserve) { setConflict(false); setReview(true); setReviewed(false); }
      }
    } finally { if (!signal?.aborted) setLoading(false); }
    // Retry deadline is stateful; it must not retrigger fetching or erase drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);
  useEffect(() => { const controller = new AbortController(); void load(false, controller.signal); return () => controller.abort(); }, [load]);
  function edit(name: string, value: Value) {
    setDraft(previous => ({ ...previous, [name]: value }));
    setDirty(previous => previous.includes(name) ? previous : [...previous, name]); setSuccess("");
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || revision === undefined || conflict || (review && !reviewed) || retry.seconds) return;
    setBusy(true); setSuccess(""); setError(undefined);
    try {
      const result = readResource(screen, await apiJson(`/${screen}/me`, {
        method: screen === "questionnaire" ? "PUT" : "PATCH", json: resourcePayload(screen, revision, draft, dirty), signal: AbortSignal.timeout(15000),
      }));
      setDraft(result.values); setSaved(result.values); setRevision(result.revision); setDirty([]); setEmpty(false);
      setReview(false); setReviewed(false); setSuccess("Your changes were saved.");
    } catch (failure) {
      setError(failure); retry.fromError(failure);
      if (failure instanceof ApiError && failure.status === 409) { setConflict(true); setReviewed(false); }
      if (failure instanceof ApiError && failure.code === "DATA_SHAPE_UNAVAILABLE" && failure.resourceRevision !== undefined) setRevision(failure.resourceRevision);
    } finally { setBusy(false); }
  }
  const disabled = busy || loading;
  const denied = error instanceof ApiError && [401, 403].includes(error.status ?? 0);
  const fieldError = (name: string) => errors[name];
  const fieldId = (name: string) => `${screen}-${name}`;
  function text(name: string, type = "text") {
    const age = name === "minAge" || name === "maxAge";
    return <Input key={name} id={fieldId(name)} name={name} label={labels[name]} error={fieldError(name)}
      type={age ? "number" : type} min={age ? 18 : undefined} max={age ? 120 : undefined} step={age ? 1 : undefined}
      value={draft[name] === null ? "" : String(draft[name] ?? "")} disabled={disabled}
      hint={age ? "18–120. Leave blank to remove this bound." : name === "birthDate" ? "Optional for a draft; required to be eligible for matching. Self-reported, not verified age." : "Leave blank to clear this value."}
      onChange={event => edit(name, event.target.value === "" ? null : age ? Number(event.target.value) : event.target.value)} />;
  }
  function list(name: string, catalog: string[], hint: string) {
    const selected = Array.isArray(draft[name]) ? draft[name] as string[] : [];
    return <Fieldset key={name} id={fieldId(name)} legend={labels[name]} aria-describedby={`${fieldId(name)}-hint`}>
      <p id={`${fieldId(name)}-hint`} className="field__hint">{hint} {draft[name] === null ? "Currently unset." : selected.length ? "" : "Explicitly empty."}</p>
      {catalog.map(value => <Checkbox key={value} name={`${name}-${value}`} label={value.replaceAll("-", " ")}
        checked={selected.includes(value)} disabled={disabled} onChange={event => edit(name, event.target.checked ? [...selected, value] : selected.filter(item => item !== value))} />)}
      {name === "priorities" && selected.map((value, index) => <div className="inline" key={value}>
        <span>{index + 1}. {value.replaceAll("-", " ")}</span>
        <Button size="small" variant="quiet" disabled={disabled || index === 0} aria-label={`Move ${value} earlier`} onClick={() => {
          const next = [...selected]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; edit(name, next);
        }}>Move {value} earlier</Button>
      </div>)}
      <div className="inline"><Button variant="quiet" disabled={disabled} onClick={() => edit(name, null)}>Unset {labels[name].toLowerCase()}</Button>
        <Button variant="quiet" disabled={disabled} onClick={() => edit(name, [])}>Empty {labels[name].toLowerCase()}</Button></div>
      {fieldError(name) && <p className="field__error" role="alert">{fieldError(name)}</p>}
    </Fieldset>;
  }
  const goal = <Select id={fieldId("relationshipGoal")} name="relationshipGoal" label="Relationship goal" error={fieldError("relationshipGoal")}
    value={String(draft.relationshipGoal ?? "")} disabled={disabled} onChange={event => edit("relationshipGoal", event.target.value || null)}>
    <option value="">Not set</option>{goals.map(value => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}
  </Select>;
  return <div className="stack">
    {loading && <LoadingState label="Loading your saved choices…" />}
    {error !== undefined && <div ref={summary} id={`${screen}-summary`} tabIndex={-1}>
      <Notice tone="error" title={memberErrorMessage(error)}>
        {error instanceof ApiError && error.code === "DATA_SHAPE_UNAVAILABLE" && <p>Saved fields could not be loaded safely. Blank controls do not mean those saved values are empty. Only fields you explicitly change will be submitted. If the listed corrections cannot resolve the issue, request support review; no automatic repair is performed.</p>}
        {Object.entries(errors).map(([field, message]) => <p key={field}><a href={`#${field === "_form" ? `${screen}-summary` : fieldId(field)}`}>{message}</a></p>)}
        {error instanceof ApiError && error.status === 401 && <Link href="/login?next=%2Faccount">Sign in</Link>}
      </Notice>
    </div>}
    <RetryAfterFeedback seconds={retry.seconds} id={`${screen}-retry`} />
    {success && <Notice tone="success" title={success} />}
    <Button variant="secondary" disabled={busy || loading || retry.seconds > 0} onClick={() => void load(dirty.length > 0 || conflict)}>
      {conflict ? "Load latest version for review" : "Refresh saved data"}
    </Button>
    {review && <div className="stack"><Notice tone="warning" title="Your edits have been kept. Review before saving.">
      <p>Compare the latest saved values below with your form. Nothing will be submitted automatically.</p>
      {saved && <details><summary>Latest saved values</summary><dl>{Object.entries(saved).map(([key, value]) => <div key={key}>
        <dt>{labels[key] ?? questions.find((_q, i) => key === `answers.${i}.responseText`)?.prompt ?? key}</dt>
        <dd>{value === null ? "Not set" : Array.isArray(value) ? value.join(", ") || "Empty list" : String(value)}</dd>
      </div>)}</dl></details>}
    </Notice><Checkbox name="reviewed" label="I reviewed the latest saved data and want to submit my edits." checked={reviewed} onChange={event => setReviewed(event.target.checked)} /></div>}
    {empty && !loading && <EmptyState title="Nothing saved yet">Complete the fields you want to save. No matching or consent is enabled by saving this form.</EmptyState>}
    {revision !== undefined && !denied && <Form onSubmit={save} noValidate>
      {screen === "profile" && <>{text("birthDate", "date")}{text("occupation")}{text("city")}
        <Textarea id={fieldId("bio")} name="bio" label="About you" hint="Up to 2000 Unicode characters; blank clears the value." error={fieldError("bio")} value={String(draft.bio ?? "")} disabled={disabled} onChange={event => edit("bio", event.target.value === "" ? null : event.target.value)} />
        {goal}{list("interests", interests, "Choose your interests.")}{list("values", valuesCatalog, "Choose values that matter to you.")}
        <Checkbox id={fieldId("visibilityEnabled")} name="visibilityEnabled" label="Visible for matching" hint="Visibility does not grant matching consent or guarantee eligibility." checked={draft.visibilityEnabled === true} disabled={disabled} onChange={event => edit("visibilityEnabled", event.target.checked)} />
      </>}
      {screen === "questionnaire" && <><p>Questionnaire version 1. Submit all three answers together; 1–2000 Unicode characters per answer.</p>
        {questions.map((question, i) => { const name = `answers.${i}.responseText`; return <Textarea key={question.key} id={fieldId(name)} name={name}
          label={question.prompt} required error={fieldError(name) ?? errors.answers} value={String(draft[name] ?? "")} disabled={disabled} onChange={event => edit(name, event.target.value)} />; })}
      </>}
      {screen === "preferences" && <>{text("minAge")}{text("maxAge")}{goal}
        {list("dealBreakers", ["different-relationship-goal"], "Different goals are a hard exclusion only when explicitly selected; otherwise your goal remains a preference.")}
        {list("priorities", priorities, "Compare earlier criteria first, then later ones only on ties. Unset uses relationship goal, values, interests; empty uses none. No weights are assigned.")}
      </>}
      <FormActions><Button type="submit" loading={busy} disabled={loading || !dirty.length || conflict || (review && !reviewed) || retry.seconds > 0}>Save changes</Button></FormActions>
    </Form>}
    <p className="small muted">Consent choices remain separate. <Link href="/account/consents">Manage or withdraw consent</Link>.</p>
  </div>;
}
