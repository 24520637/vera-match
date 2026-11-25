"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiJson } from "@/lib/api";
import { isConnectionMessage, isConnectionMessages, isMatchConnection, resizeConnectionPhoto,
  type ConnectionMessage, type ConnectionMessages, type MatchConnection } from "@/lib/match-connections";
import { useAuth } from "../auth/auth-provider";
import { PageHeader } from "../layout/page-layout";
import { Button } from "../ui/button";
import { LoadingState, Notice } from "../ui/status";
import "./match-connection.css";

type Flags = { profileShared: boolean; contactShared: boolean; chatEnabled: boolean };
type PendingMessage = { clientMessageId: string; text: string };
const emptyFlags: Flags = { profileShared: false, contactShared: false, chatEnabled: false };
function failure(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 400) return "This connection is unavailable or its link expired. Return to Your matches and refresh the list.";
    if (error.status === 409) return "The connection changed. Refresh and review your settings before trying again.";
    if (error.status === 429) return `Too many requests. Wait ${error.retryAfterSeconds ?? 60} seconds, then refresh.`;
    if (error.status === 401) return "Sign in again, then refresh Your matches.";
    if (error.code === "CHAT_NOT_ENABLED") return "Both members must enable chat. Refresh the connection to check sharing.";
  }
  return "The connection could not be checked. Refresh before continuing.";
}
function mergeMessages(current: ConnectionMessage[], incoming: ConnectionMessage[]) {
  const messages = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function ConnectionScreen({ connectionId, email }: { connectionId: string; email: string }) {
  const path = `/matches/connections/${connectionId}`;
  const [data, setData] = useState<MatchConnection | null>(null);
  const [flags, setFlags] = useState<Flags>(emptyFlags);
  const [photo, setPhoto] = useState<string | null | undefined>();
  const [messages, setMessages] = useState<ConnectionMessage[]>([]);
  const [older, setOlder] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const dirty = useRef(false), busy = useRef(false), paused = useRef(false), initialized = useRef(false);
  const alive = useRef(false), epoch = useRef(0);
  const readRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (busy.current || document.hidden) return;
    busy.current = true;
    const generation = ++epoch.current;
    const controller = new AbortController();
    readRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const value = await apiJson<unknown>(path, { signal: controller.signal });
      if (!isMatchConnection(value)) throw new Error("Invalid connection response");
      let page: ConnectionMessages | undefined;
      if (value.chatAvailable) {
        const result = await apiJson<unknown>(path + "/messages", { signal: controller.signal });
        if (!isConnectionMessages(result)) throw new Error("Invalid messages response");
        page = result;
      }
      if (!alive.current || generation !== epoch.current || document.hidden) return;
      setData(value); setError(""); paused.current = false;
      if (!dirty.current) {
        setFlags({ profileShared: value.sharing.profileShared, contactShared: value.sharing.contactShared, chatEnabled: value.sharing.chatEnabled });
        setPhoto(undefined);
      }
      if (page) {
        setMessages(previous => mergeMessages(previous, page!.messages));
        if (!initialized.current) { setOlder(page.nextCursor); initialized.current = true; }
      } else { setMessages([]); setOlder(null); initialized.current = false; }
    } catch (err) {
      if (alive.current && generation === epoch.current) {
        setData(null); setMessages([]); setOlder(null); initialized.current = false;
        setError(failure(err)); paused.current = true;
      }
    } finally {
      clearTimeout(timeout);
      if (readRequest.current === controller) { readRequest.current = null; busy.current = false; }
      if (alive.current && generation === epoch.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const visibility = () => {
      ++epoch.current;
      if (document.hidden) {
        if (readRequest.current) { readRequest.current.abort(); readRequest.current = null; busy.current = false; }
        setData(null); setMessages([]); setOlder(null); initialized.current = false;
      } else { void refresh(); }
    };
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(() => { if (!paused.current) void refresh(); }, 10000);
    return () => {
      alive.current = false; ++epoch.current;
      if (readRequest.current) { readRequest.current.abort(); readRequest.current = null; busy.current = false; }
      clearInterval(timer); document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh]);

  async function saveSharing() {
    if (!data || busy.current || document.hidden) return;
    busy.current = true; setWorking(true); setNotice("");
    const generation = epoch.current;
    try {
      await apiJson(path + "/sharing", { method: "POST", signal: AbortSignal.timeout(15000), json: {
        expectedRevision: data.sharing.revision, ...flags,
        ...(photo !== undefined && { photo }),
      } });
      if (!alive.current || generation !== epoch.current || document.hidden) return;
      dirty.current = false; setNotice("Sharing saved.");
    } catch (err) {
      if (alive.current) { setError(failure(err)); setData(null); setMessages([]); paused.current = true; }
    } finally {
      busy.current = false;
      if (alive.current) setWorking(false);
    }
    if (!paused.current) await refresh();
  }

  async function send() {
    if (document.hidden || !data?.chatAvailable || busy.current || (!pending && !draft.trim())) return;
    const message = pending ?? { clientMessageId: crypto.randomUUID(), text: draft.trim() };
    setPending(message); busy.current = true; setWorking(true); setNotice("");
    const generation = epoch.current;
    try {
      const result = await apiJson<{ message: unknown }>(path + "/messages", { method: "POST", signal: AbortSignal.timeout(15000), json: message });
      if (!result || !isConnectionMessage(result.message)) throw new Error("Invalid message receipt");
      if (!alive.current || generation !== epoch.current || document.hidden) return;
      setMessages(current => mergeMessages(current, [result.message as ConnectionMessage]));
      setPending(null); setDraft(""); setNotice("Message sent.");
    } catch (err) {
      if (alive.current) { setError(failure(err) + " Your message reference is retained for an exact retry."); setData(null); setMessages([]); paused.current = true; }
    } finally {
      busy.current = false;
      if (alive.current) setWorking(false);
    }
  }

  async function loadOlder() {
    if (document.hidden || !older || busy.current) return;
    busy.current = true; setWorking(true);
    const generation = epoch.current;
    try {
      const result = await apiJson<unknown>(path + "/messages?before=" + encodeURIComponent(older), { signal: AbortSignal.timeout(15000) });
      if (!isConnectionMessages(result)) throw new Error("Invalid messages");
      if (!alive.current || generation !== epoch.current || document.hidden) return;
      setMessages(current => mergeMessages(current, result.messages)); setOlder(result.nextCursor);
    } catch (err) {
      if (alive.current) { setData(null); setMessages([]); setError(failure(err)); paused.current = true; }
    } finally { busy.current = false; if (alive.current) setWorking(false); }
  }

  const profile = data?.peer.profile;
  return <div className="container match-connection stack">
    <Link href="/account/matches">Back to Your matches</Link>
    <PageHeader title="You both said yes." description="Get to know each other at your own pace. You choose what to share." />
    <nav className="form-actions" aria-label="Connection sections"><Link href="#match-profile-heading">Their profile</Link><Link href="#match-sharing-heading">Your sharing choices</Link><Link href="#match-chat-heading">Conversation</Link></nav>
    <Button variant="secondary" disabled={working} onClick={() => void refresh()}>Refresh connection</Button>
    {loading && <LoadingState label="Checking connection…" />}
    {error && <Notice tone="error" title="Connection needs attention">{error}</Notice>}
    {notice && <p role="status">{notice}</p>}
    {data && <>
      <section className="stack" aria-labelledby="match-profile-heading">
        <h2 id="match-profile-heading">Their profile</h2>
        {profile ? <>
          {profile.photo && <img className="match-connection__photo" src={profile.photo} alt={`Photo shared by ${profile.displayName ?? "your match"}`} width={160} height={160} />}
          <h3>{profile.displayName ?? "Your match"}, {profile.age}</h3>
          <dl className="match-connection__details">
            {profile.city && <><dt>City</dt><dd>{profile.city}</dd></>}
            {profile.occupation && <><dt>Occupation</dt><dd>{profile.occupation}</dd></>}
            {profile.relationshipGoal && <><dt>Relationship goal</dt><dd>{profile.relationshipGoal === "long-term" ? "Long-term relationship" : "Exploring"}</dd></>}
            <dt>Interests</dt><dd>{profile.interests.join(", ") || "Not provided"}</dd>
            <dt>Values</dt><dd>{profile.values.join(", ") || "Not provided"}</dd>
          </dl>
          {profile.bio && <p className="match-connection__text">{profile.bio}</p>}
        </> : <p>This person has not shared their profile with you yet.</p>}
        {data.peer.contactEmail ? <p>Shared email: <a href={`mailto:${data.peer.contactEmail}`}>{data.peer.contactEmail}</a></p>
          : <p>This person has not shared their email.</p>}
      </section>
      <section className="stack" aria-labelledby="match-sharing-heading">
        <h2 id="match-sharing-heading">What you share with this person</h2>
        <p>Profile sharing includes your name, age, city, occupation, bio, interests, values and chosen photo. You can turn each choice off. Information already seen may have been saved by its recipient.</p>
        <form className="stack" onSubmit={event => { event.preventDefault(); void saveSharing(); }}>
          <div className="choice stack">
          <label><input type="checkbox" checked={flags.profileShared} disabled={working} onChange={event => { dirty.current = true; setFlags({ ...flags, profileShared: event.target.checked }); }} /> Share my profile with this person</label>
          <label><input type="checkbox" checked={flags.contactShared} disabled={working} onChange={event => { dirty.current = true; setFlags({ ...flags, contactShared: event.target.checked }); }} /> Share my account email ({email})</label>
          <label><input type="checkbox" checked={flags.chatEnabled} disabled={working} onChange={event => { dirty.current = true; setFlags({ ...flags, chatEnabled: event.target.checked }); }} /> Enable chat with this person</label>
          </div>
          <label htmlFor="connection-photo">Photo for this connection (optional, JPEG/PNG/WebP up to 5 MB)</label>
          <input id="connection-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={working} onChange={async event => {
            const file = event.target.files?.[0]; if (!file) return;
            dirty.current = true; setWorking(true);
            try { const value = await resizeConnectionPhoto(file); if (alive.current) { dirty.current = true; setPhoto(value); } }
            catch (err) { if (alive.current) setNotice(err instanceof Error ? err.message : "The photo could not be read."); }
            finally { if (alive.current) setWorking(false); }
          }} />
          {(photo === undefined ? data.sharing.photo : photo) && <>
            <img className="match-connection__photo" src={(photo === undefined ? data.sharing.photo : photo)!} alt="Your connection photo" width={120} height={120} />
            <Button variant="secondary" disabled={working} onClick={() => { dirty.current = true; setPhoto(null); }}>Remove photo</Button>
          </>}
          <Button type="submit" disabled={working}>Save sharing choices</Button>
        </form>
      </section>
      <section className="stack" aria-labelledby="match-chat-heading">
        <h2 id="match-chat-heading">Conversation</h2>
        {data.chatAvailable ? <>
          {older && <Button variant="secondary" disabled={working} onClick={() => void loadOlder()}>Load older messages</Button>}
          {!messages.length && <p>No messages yet. Start your conversation.</p>}
          <ol className="match-connection__messages" aria-label="Conversation messages">
            {messages.map(message => <li key={message.id} className={`match-connection__message match-connection__message--${message.sender}`}>
              <strong>{message.sender === "me" ? "You" : profile?.displayName ?? "Your match"}</strong>
              <p className="match-connection__text">{message.text}</p>
              <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
            </li>)}
          </ol>
          <form className="stack" onSubmit={event => { event.preventDefault(); void send(); }}>
            <label htmlFor="connection-message">Message</label>
            <textarea className="control" id="connection-message" maxLength={2000} rows={3} value={pending?.text ?? draft} disabled={working || !!pending}
              onChange={event => setDraft(event.target.value)} />
            <Button type="submit" disabled={working || (!pending && !draft.trim())}>{pending ? "Retry message" : "Send message"}</Button>
          </form>
        </> : <p>{data.sharing.chatEnabled ? "Waiting for the other person to enable chat." : "Enable chat in your sharing choices. Both people must enable it before messages can be read or sent."}</p>}
      </section>
    </>}
  </div>;
}

export function MatchConnectionScreen({ connectionId }: { connectionId: string }) {
  const { state } = useAuth();
  if (state.status === "checking") return <LoadingState label="Checking your session…" />;
  if (state.status !== "authenticated" || state.user.role !== "MEMBER") {
    return <Notice title="Member access required">Sign in with the member account that owns this connection.</Notice>;
  }
  return <ConnectionScreen key={`${state.user.id}:${connectionId}`} connectionId={connectionId} email={state.user.email} />;
}
