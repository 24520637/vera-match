"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, apiJson } from "@/lib/api";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
import { Button } from "../ui/button";
import { Form, FormActions, Input } from "../ui/form";
import { Notice } from "../ui/status";

export function ClosureStatus() {
  const [token,setToken]=useState("");
  const heading=useRef<HTMLHeadingElement>(null);
  const [pending,setPending]=useState<"status"|"email"|null>(null),[verified,setVerified]=useState(false),[requested,setRequested]=useState(false),[message,setMessage]=useState("");
  const retry=useRetryAfter();
  useEffect(()=>{
    const capture=()=>{
      if(!location.hash)return;
      const candidate=new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
      setToken(/^[A-Za-z0-9_-]{43}$/.test(candidate)?candidate:"");
      setVerified(false);setRequested(false);setMessage("");
      history.replaceState(history.state,"",location.pathname);
    };
    capture();
    const clear=()=>setToken("");
    window.addEventListener("hashchange",capture);window.addEventListener("pagehide",clear);
    return ()=>{window.removeEventListener("hashchange",capture);window.removeEventListener("pagehide",clear);};
  },[]);
  useEffect(()=>{if(verified)heading.current?.focus();},[verified]);
  async function consume() {
    if(!token || pending || retry.seconds)return;
    setPending("status");setMessage("");
    try {
      const result=await apiJson<{state:string;revision:number;cleanupPending:boolean;retentionPending:boolean}>("/account-closure/status",{method:"POST",json:{token}});
      if(!result || !["RESTRICTED","RETENTION_PENDING"].includes(result.state) || !Number.isSafeInteger(result.revision) || result.revision<1 || result.cleanupPending !== true || result.retentionPending !== true)throw Error("Unconfirmed lifecycle status");
      setVerified(true);setToken("");
    } catch(error) {
      retry.fromError(error);
      if(error instanceof ApiError && error.status === 429)setMessage("Wait before checking this link again. No check will run automatically.");
      else {setToken("");setMessage("Status could not be verified. Request a new email link. Your account access is not restored by this page.");}
    } finally {setPending(null);}
  }
  async function requestEmail(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(pending || retry.seconds)return;
    const form=event.currentTarget,email=String(new FormData(form).get("email")??"").trim();
    setPending("email");setMessage("");setRequested(false);
    try {
      await apiJson("/account-closure/status-email",{method:"POST",json:{email}});
      form.reset();setRequested(true);retry.start(60);
    } catch(error){retry.fromError(error);setMessage("The email request could not be confirmed. You can try again later.");}
    finally {setPending(null);}
  }
  return <div className="stack">
    <h2 className="auth-form-title" ref={heading} tabIndex={-1}>{verified ? "Access remains closed":"Check closure progress"}</h2>
    {verified ? <Notice tone="warning" title="Cleanup and retention remain pending">Closure was accepted. This status does not confirm that every retained copy has been erased.</Notice> :
      <p>Use the one-time link sent to your previously verified email address. A status check does not sign you in or restore account access.</p>}
    {token && !verified && <Button onClick={()=>void consume()} loading={pending === "status"} loadingLabel="Checking closure status…" disabled={!!pending || retry.seconds>0}>Check closure progress</Button>}
    {message && <Notice tone="warning" title="Check before continuing">{message}</Notice>}
    <Form onSubmit={requestEmail} aria-label="Request a restricted closure status link">
      <Input id="closure-status-email" name="email" label="Previously verified email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required disabled={!!pending} />
      <FormActions><Button type="submit" variant="secondary" loading={pending === "email"} loadingLabel="Requesting status email…" disabled={!!pending || retry.seconds>0}>Request status link</Button></FormActions>
      <RetryAfterFeedback seconds={retry.seconds} id="closure-status-cooldown" />
    </Form>
    {requested && <Notice tone="success" title="Request received">If this address is eligible, a restricted status link will be emailed. If you no longer have access to that mailbox, contact the project owner; this page cannot bypass verification.</Notice>}
  </div>;
}
