"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, apiJson } from "@/lib/api";
import { useAuth } from "../auth/auth-provider";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";
import { Notice } from "../ui/status";

const categories = ["EYE", "FACIAL", "BODY", "SPEECH", "CROSS_MODAL"] as const;
type Note = {
  category: typeof categories[number]; startMs: string; endMs: string;
  observation: string; context: string;
};
type Draft = {
  id: string; version: number; summary: string | null; limitations: string | null;
  feedback?: string | null;
  observations: Array<Omit<Note, "startMs" | "endMs" | "context"> & { startMs: number; endMs: number; context: string | null }>;
};
type Submission = { id: string; version: number; status: "SUBMITTED"; submittedAt: string };
type DraftResponse = { draft: Draft | null; durationMs: number | null; submission?: Submission };
type Playback = { url: string; expiresAt: string };
const reference = /^[A-Za-z0-9_-]{1,200}$/;

function fields(draft: Draft) {
  return {
    summary: draft.summary ?? "", limitations: draft.limitations ?? "",
    notes: draft.observations.map(note => ({ category: note.category, startMs: String(note.startMs),
      endMs: String(note.endMs), observation: note.observation, context: note.context ?? "" })),
  };
}

function notesAreValid(notes: Note[], durationMs: number | null | undefined) {
  return notes.every(note => note.observation.trim() && note.context.trim() &&
    /^\d+$/.test(note.startMs) && /^\d+$/.test(note.endMs) &&
    Number(note.endMs) >= Number(note.startMs) && Number(note.endMs) <= (durationMs ?? -1));
}

export function ExpertReviewWorkspace({ assignmentId }: { assignmentId: string }) {
  const { state } = useAuth();
  if (state.status === "checking") return <p role="status">Checking your session…</p>;
  if (state.status !== "authenticated" || state.user.role !== "EXPERT")
    return <Notice title="Review unavailable">Sign in with an authorized expert session to open this workspace.</Notice>;
  if (!reference.test(assignmentId))
    return <Notice title="Review unavailable">Use a valid assignment reference.</Notice>;
  return <Workspace key={JSON.stringify([state.user.id, assignmentId])} assignmentId={assignmentId} />;
}

function Workspace({ assignmentId }: { assignmentId: string }) {
  const path = `/expert/assignments/${assignmentId}`;
  const [data, setData] = useState<DraftResponse>();
  const [form, setForm] = useState<ReturnType<typeof fields>>();
  const [busy, setBusy] = useState(true), [dirty, setDirty] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [error, setError] = useState(""), [version, reload] = useState(0);
  const [media, setMedia] = useState<Playback>(), [playbackBusy, setPlaybackBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const requests = useRef<AbortController | null>(null);
  const validNotes = !!form && notesAreValid(form.notes, data?.durationMs);

  function report(err: unknown) {
    if (err instanceof ApiError) {
      if ([401, 403, 404].includes(err.status ?? 0)) {
        setData(undefined); setForm(undefined); setMedia(undefined); setDirty(false); setNotesDirty(false);
        setError("Review access could not be confirmed. Check your session and assignment.");
        return;
      }
      if (err.status === 409) { setError("This draft changed elsewhere. Reload the saved draft to continue."); return; }
      if (err.code === "REVIEW_INCOMPLETE") { setError("Complete and save the summary and limitations before submitting."); return; }
      if (err.status === 422) { setError("Check that each time range is within the verified video duration."); return; }
      if (err.status === 429) { setError("Too many requests. Wait before retrying."); return; }
    }
    setError("The request could not be confirmed. Reload or retry manually.");
  }

  useEffect(() => {
    const controller = new AbortController();
    requests.current = controller;
    setBusy(true); setError(""); setMedia(undefined);
    void apiJson<DraftResponse>(path + "/draft", { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (!result) throw new Error("Missing draft response.");
      setData(result); setForm(result.draft ? fields(result.draft) : undefined); setDirty(false); setNotesDirty(false);
    }).catch(err => { if (!controller.signal.aborted) report(err); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [path, version]);

  useEffect(() => {
    if (!media) return;
    const timer = window.setTimeout(() => setMedia(undefined), Math.max(0, Date.parse(media.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [media]);

  async function initialize() {
    const signal = requests.current!.signal;
    setBusy(true); setError("");
    try {
      const result = await apiJson<DraftResponse>(path + "/draft", { method: "POST", json: {}, signal });
      if (signal.aborted) return;
      if (!result?.draft) throw new Error("Missing draft.");
      setData(result); setForm(fields(result.draft));
    } catch (err) { if (!signal.aborted) report(err); }
    finally { if (!signal.aborted) setBusy(false); }
  }

  async function playback() {
    const signal = requests.current!.signal;
    setPlaybackBusy(true); setMedia(undefined);
    try {
      const result = await apiJson<Playback>(path + "/playback", { method: "POST", json: {}, signal });
      if (signal.aborted) return;
      if (!result || !(Date.parse(result.expiresAt) > Date.now())) throw new Error("Playback expired.");
      const url = new URL(result.url);
      if (url.username || url.password ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))))
        throw new Error("Invalid playback URL.");
      setMedia(result);
    } catch (err) { if (!signal.aborted) report(err); }
    finally { if (!signal.aborted) setPlaybackBusy(false); }
  }

  async function submit() {
    const draft = data?.draft;
    if (!draft || !form?.summary.trim() || !form.limitations.trim() || !validNotes || busy || playbackBusy || dirty || error) return;
    const signal = requests.current!.signal;
    setBusy(true);
    setConfirming(false);
    setMedia(undefined);
    try {
      const submission = await apiJson<Submission>(`/expert/reviews/${draft.id}/submit`, {
        method: "POST", signal, json: { expectedVersion: draft.version },
      });
      if (signal.aborted) return;
      if (!submission) throw new Error("Missing submission.");
      setData({ draft: null, durationMs: null, submission });
      setForm(undefined);
    } catch (err) { if (!signal.aborted) report(err); }
    finally { if (!signal.aborted) setBusy(false); }
  }

  useEffect(() => {
    const draft = data?.draft;
    if (!dirty || busy || playbackBusy || error || !form || !draft) return;
    // Incomplete observations stay local until the whole draft is valid.
    if (notesDirty && !notesAreValid(form.notes, data?.durationMs)) return;
    const timer = window.setTimeout(async () => {
      const signal = requests.current!.signal;
      setBusy(true);
      try {
        const result = await apiJson<DraftResponse>(`/expert/reviews/${draft.id}/draft`, { method: "PATCH", signal, json: {
          expectedVersion: draft.version, summary: form.summary || null, limitations: form.limitations || null,
          ...(notesDirty ? { observations: form.notes.map(note => ({ ...note, startMs: Number(note.startMs), endMs: Number(note.endMs) })) } : {}),
        } });
        if (signal.aborted) return;
        if (!result?.draft) throw new Error("Missing draft.");
        setData(result); setDirty(false); setNotesDirty(false);
      } catch (err) { if (!signal.aborted) report(err); }
      finally { if (!signal.aborted) setBusy(false); }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [data, form, dirty, notesDirty, busy, playbackBusy, error]);

  function edit(next: React.SetStateAction<NonNullable<typeof form>>) {
    setForm(current => current && (typeof next === "function" ? next(current) : next));
    setDirty(true);
  }

  function editNote(index: number, update: Partial<Note>) {
    setNotesDirty(true);
    edit(current => ({ ...current, notes: current.notes.map((note, i) => i === index ? { ...note, ...update } : note) }));
  }

  return <main className="container page-heading">
    <h1>Expert review workspace</h1>
    {error && <Notice tone="error" title="Review request failed">{error}</Notice>}
    <Button disabled={busy || playbackBusy} onClick={() => { setData(undefined); setForm(undefined); reload(n => n + 1); }}>
      Reload saved draft
    </Button>
    {data?.submission && <Notice title="Submitted for quality review">Version {data.submission.version} is locked until a moderator reviews it.</Notice>}
    {data && !data.submission && <>
      <h2>Assigned video</h2>
      <Button disabled={busy || playbackBusy} onClick={() => void playback()}>{media ? "Renew playback" : "Load playback"}</Button>
      {media && <video ref={video} aria-label="Assigned video" controls preload="metadata" src={media.url}
        style={{ width: "100%", maxHeight: "60vh" }} onError={() => setMedia(undefined)} />}
      {!data.durationMs && <p role="status">Verified duration is unavailable. Timecoded observations cannot be saved.</p>}
      {!data.draft && <Button disabled={busy} onClick={() => void initialize()}>Start draft</Button>}
      {data.draft && form && <fieldset disabled={busy || playbackBusy}>
        <legend>Private review draft</legend>
        {data.draft.feedback && <Notice title="Returned for revision"><span style={{ whiteSpace: "pre-wrap" }}>{data.draft.feedback}</span></Notice>}
        <p role="status">{busy ? "Saving…" : dirty ? "Unsaved changes" : `Saved version ${data.draft.version}`}</p>
        {!validNotes && <p role="status">Correct or remove observations with missing evidence, context or verified time ranges before submitting.</p>}
        {error && dirty && <Button onClick={() => setError("")} disabled={error.startsWith("This draft changed")}>Retry save</Button>}
        <p>Describe what is observable and explain the context. Use Limitations to record uncertainty and limits of the source.</p>
        <p><label>Summary<br /><textarea value={form.summary} onChange={e => edit({ ...form, summary: e.target.value })} /></label></p>
        <p><label>Limitations<br /><textarea value={form.limitations} onChange={e => edit({ ...form, limitations: e.target.value })} /></label></p>
        <ol aria-label="Timeline observations">
          {form.notes.map((note, index) => <li key={index}>
            <fieldset>
              <legend>Observation {index + 1}</legend>
              <label>Category <select value={note.category} onChange={e => editNote(index, { category: e.target.value as Note["category"] })}>
                {categories.map(category => <option key={category}>{category}</option>)}
              </select></label>
              <label> Start (ms) <input type="number" min="0" step="1" value={note.startMs} onChange={e => editNote(index, { startMs: e.target.value })} /></label>
              <label> End (ms) <input type="number" min="0" step="1" value={note.endMs} onChange={e => editNote(index, { endMs: e.target.value })} /></label>
              <Button disabled={!media || !/^\d+$/.test(note.startMs)} onClick={() => { if (video.current) video.current.currentTime = Number(note.startMs) / 1000; }}>
                Jump to start
              </Button>
              <p><label>Observable evidence<br /><textarea value={note.observation} onChange={e => editNote(index, { observation: e.target.value })} /></label></p>
              <p><label>Context<br /><textarea value={note.context} onChange={e => editNote(index, { context: e.target.value })} /></label></p>
              <Button onClick={() => {
                setNotesDirty(true);
                edit(current => ({ ...current, notes: current.notes.filter((_, i) => i !== index) }));
              }}>Remove observation</Button>
            </fieldset>
          </li>)}
        </ol>
        <Button disabled={!data.durationMs} onClick={() => {
          setNotesDirty(true);
          const stamp = String(Math.floor((video.current?.currentTime ?? 0) * 1000));
          edit(current => ({ ...current, notes: [...current.notes, { category: "EYE", startMs: stamp, endMs: stamp, observation: "", context: "" }] }));
        }}>Add observation</Button>
        <p>Save the summary and limitations before submitting for independent quality review.</p>
        <Button disabled={dirty || !!error || !validNotes || !form.summary.trim() || !form.limitations.trim()} onClick={() => setConfirming(true)}>
          Submit for quality review
        </Button>
      </fieldset>}
    </>}
    <Modal open={confirming} onOpenChange={setConfirming} title="Submit this review?"
      description="The saved version will be locked for an independent moderator to review.">
      <Button variant="secondary" onClick={() => setConfirming(false)}>Keep editing</Button>
      <Button onClick={() => void submit()}>Confirm submission</Button>
    </Modal>
    {busy && !data && <p role="status">Loading review…</p>}
  </main>;
}
