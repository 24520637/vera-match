"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, apiJson } from "@/lib/api";
import { useAuth } from "../auth/auth-provider";
import { PasswordInput } from "../auth/password-input";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
import { Modal } from "../ui/modal";
import { Button } from "../ui/button";
import { ErrorSummary, Form, FormActions, Input, focusFirstError } from "../ui/form";
import { LoadingState, Notice } from "../ui/status";
import { PageHeader } from "../layout/page-layout";
import { MemberSettingsNav } from "../member/member-settings";
import "../member/member-settings.css";

export function AccountClosure() {
  const { state } = useAuth();
  if (state.status !== "authenticated") return <Notice tone="warning" title="Session unavailable">Sign in again before changing account access.</Notice>;
  if (state.user.role !== "MEMBER") return <Notice tone="error" title="Member self-service only">Staff accounts need a separate access-removal review.</Notice>;
  return <div className="container member-settings"><MemberSettingsNav />
    <PageHeader title="Close your account" description="Take a moment to review what happens to your access and private information." />
    <ClosureForm key={state.user.id} />
  </div>;
}
function ClosureForm() {
  const { clearUser } = useAuth();
  const [availability, setAvailability] = useState<"loading"|"available"|"unreleased"|"unavailable">("loading");
  const [check, setCheck] = useState(0);
  const [confirming,setConfirming]=useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string,string>>({});
  const key = useRef<string | null>(null), formRef = useRef<HTMLFormElement>(null);
  const retry = useRetryAfter();
  useEffect(() => {
    const controller = new AbortController();
    setAvailability("loading");
    void apiJson<{available:boolean}>("/account-closure/availability",{signal:controller.signal})
      .then(result => { if(!controller.signal.aborted) setAvailability(result?.available === true ? "available" : result?.available === false ? "unreleased":"unavailable"); })
      .catch(() => {if(!controller.signal.aborted)setAvailability("unavailable");});
    return () => controller.abort();
  },[check]);
  useEffect(() => {
    const clear = () => {formRef.current?.reset();setConfirming(false);};
    const hidden = () => {if(document.visibilityState === "hidden") clear();};
    window.addEventListener("pagehide",clear);document.addEventListener("visibilitychange",hidden);
    return () => {window.removeEventListener("pagehide",clear);document.removeEventListener("visibilitychange",hidden);};
  },[]);
  async function submit(event?:FormEvent<HTMLFormElement>, confirmed=false) {
    event?.preventDefault(); if(pending || uncertain || retry.seconds || availability !== "available")return;
    const form=event?.currentTarget ?? formRef.current;if(!form)return;
    const data=new FormData(form),password=String(data.get("password") ?? ""),confirmation=String(data.get("confirmation") ?? "");
    const next:Record<string,string>={};
    if(!password || new TextEncoder().encode(password).length>1024) next["closure-password"]="Enter your current password.";
    if(confirmation !== "CLOSE MY ACCOUNT")next["closure-confirmation"]="Type CLOSE MY ACCOUNT exactly.";
    setErrors(next);setMessage("");
    if(Object.keys(next).length){setConfirming(false);focusFirstError(form);return;}
    if(!confirmed){setConfirming(true);return;}
    setPending(true);key.current ??= crypto.randomUUID();
    try {
      const result=await apiJson<{receiptId:string;state:string;revision:number;cleanupPending:boolean}>("/account-closure",{
        method:"POST",headers:{"Idempotency-Key":key.current},json:{password,confirmation,expectedRevision:0},
      });
      if(!result || typeof result.receiptId !== "string" || result.state !== "RESTRICTED" || result.revision !== 1 || result.cleanupPending !== true)throw new Error("Unconfirmed closure response");
      form.reset();clearUser();window.location.replace("/closure-status");
    } catch(error) {
      form.reset();retry.fromError(error);
      if(error instanceof ApiError && error.code === "CLOSURE_RELEASE_PENDING") {setAvailability("unreleased");return;}
      if(error instanceof ApiError && error.status === 400) {
        setErrors({"closure-password":"Check your current password and confirmation."});focusFirstError(form);
      } else if(error instanceof ApiError && error.status === 429) setMessage("Too many attempts. Wait, then choose whether to submit again.");
      else if(error instanceof ApiError && error.code === "STAFF_DEPROVISIONING_REQUIRED") setMessage("This account needs a separate staff access-removal review. No closure was confirmed.");
      else if(error instanceof ApiError && error.status === 403) setMessage("Your session or permissions could not confirm closure. Sign in again and review your choices before continuing.");
      else if(error instanceof ApiError && error.code === "CLOSURE_ALREADY_ACCEPTED") {setUncertain(true);setMessage("A closure request is already pending. Check its status email before taking any further action.");}
      else {setUncertain(true);setMessage("The result could not be confirmed. Check your closure status email before taking any further action.");}
    } finally {setConfirming(false);setPending(false);}
  }
  if(availability === "loading")return <LoadingState label="Checking account closure availability…" />;
  if(availability === "unreleased")return <Notice tone="warning" title="Release review pending">Self-service closure is not available in this deployment. Contact the project owner for help. No password is requested.</Notice>;
  if(availability === "unavailable")return <Notice tone="error" title="Availability could not be checked"><Button onClick={()=>setCheck(v=>v+1)}>Check availability</Button></Notice>;
  return <div className="stack">
    <Notice tone="warning" title="Review your choice">
      <p>Your sessions will end and new access to your profile, videos, reviews and matching will stop. This choice cannot be undone through self-service.</p>
      <p>Private video cleanup runs separately. Previously issued short-lived links may remain usable until expiry. Restricted evidence and backups can remain while retention and recovery obligations are resolved.</p>
    </Notice>
    <Form ref={formRef} noValidate onSubmit={submit} aria-label="Close your account">
      <ErrorSummary errors={Object.entries(errors).map(([id,message])=>({id,message}))} />
      <PasswordInput id="closure-password" name="password" label="Current password" autoComplete="current-password" required disabled={pending || uncertain} error={errors["closure-password"]} />
      <div translate="no"><Input id="closure-confirmation" name="confirmation" label="Confirm account closure" hint="Type CLOSE MY ACCOUNT to confirm." autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={pending || uncertain} error={errors["closure-confirmation"]} /></div>
      {message && <Notice tone="warning" title={uncertain ? "Check the outcome before continuing":"Closure was not confirmed"}>{message}</Notice>}
      <FormActions><Button variant="danger" type="submit" loading={pending} loadingLabel="Restricting account access…" disabled={uncertain || retry.seconds>0} aria-describedby={retry.seconds ? "closure-cooldown":undefined}>Close my account</Button></FormActions>
      <RetryAfterFeedback seconds={retry.seconds} id="closure-cooldown" />
    </Form>
    <Modal open={confirming} onOpenChange={open=>{if(!open)formRef.current?.reset();setConfirming(open)}} dismissible={!pending} title="End account access?" description="Your sessions will end. Private video cleanup and restricted retention continue separately.">
      <FormActions><Button variant="secondary" disabled={pending} onClick={()=>{formRef.current?.reset();setConfirming(false);}}>Keep my account open</Button><Button variant="danger" loading={pending} loadingLabel="Restricting account access…" onClick={()=>void submit(undefined,true)}>Confirm closure</Button></FormActions>
    </Modal>
    {uncertain && <Button onClick={()=>{formRef.current?.reset();clearUser();window.location.replace("/closure-status");}}>Check closure status</Button>}
    {!uncertain && !pending && <p className="small"><Link href="/account">Keep using my account</Link></p>}
  </div>;
}
