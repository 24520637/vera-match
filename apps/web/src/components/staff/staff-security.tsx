"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, apiJson, apiRequest } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import { useRetryAfter } from "@/components/auth/use-retry-after";
import { RetryAfterFeedback } from "@/components/auth/retry-after-feedback";
import { Button } from "@/components/ui/button";
import { Form, Input, Select, FormActions } from "@/components/ui/form";
import { LoadingState, Notice } from "@/components/ui/status";

type Setup={deviceId:string,secret?:string,expiresAt:string};
type Status={devices:{id:string,createdAt:string,activatedAt:string}[],verifiedUntil:string|null,recoveryEnrollmentAllowed:boolean,pendingEnrollment:Setup|null};
function statusValue(value:unknown):Status{
 if(!value||typeof value!=="object")throw new Error("Invalid MFA response");
 const v=value as Status;
 if(!Array.isArray(v.devices)||v.devices.length>5||v.devices.some(d=>typeof d.id!=="string"||typeof d.activatedAt!=="string")||typeof v.recoveryEnrollmentAllowed!=="boolean"||!(v.verifiedUntil===null||typeof v.verifiedUntil==="string"))throw new Error("Invalid MFA response");
 return v;
}
export function StaffSecurity(){
 const {state,refresh,clearUser}=useAuth(),retry=useRetryAfter();
 const [status,setStatus]=useState<Status|null>(null),[setup,setSetup]=useState<Setup|null>(null),[codes,setCodes]=useState<string[]>([]),[mode,setMode]=useState<"verify"|"enroll"|"recover"|"codes"|"revoke">("verify");
 const [pending,setPending]=useState(false),[loading,setLoading]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[visible,setVisible]=useState(true);
 const sequence=useRef(0),request=useRef<AbortController|null>(null),formRef=useRef<HTMLFormElement|null>(null);
 const authenticated=state.status==="authenticated"&&state.user.role!=="MEMBER";
 const read=useCallback(async()=>{
  if(!authenticated)return;const version=sequence.current;setLoading(true);
  try{const value=statusValue(await apiRequest<unknown>("/auth/staff-mfa"));if(version!==sequence.current)return;setStatus(value);setSetup(previous=>value.pendingEnrollment?{...value.pendingEnrollment,...(previous?.deviceId===value.pendingEnrollment.deviceId?{secret:previous.secret}:{})}:null);setError("");}
  catch(e){if(version!==sequence.current)return;setStatus(null);setSetup(null);setCodes([]);setError(e instanceof ApiError&&e.status===403?"Trusted staff access is required. Contact your authorized administrator.":"Staff security could not be checked. Refresh status before trying again.");}
  finally{if(version===sequence.current)setLoading(false);}
 },[authenticated]);
 useEffect(()=>{if(authenticated&&visible)void read();},[authenticated,visible,read]);
 useEffect(()=>{
  const hide=(event:Event)=>{const isVisible=event.type!=="pagehide"&&document.visibilityState==="visible";setVisible(isVisible);if(!isVisible){sequence.current++;request.current?.abort();setSetup(s=>s?{deviceId:s.deviceId,expiresAt:s.expiresAt}:null);setCodes([]);formRef.current?.reset();setPending(false);setLoading(false);setMessage("Sensitive values were hidden. Refresh status before continuing.");}};
  document.addEventListener("visibilitychange",hide);window.addEventListener("pagehide",hide);window.addEventListener("pageshow",hide);
  return()=>{sequence.current++;request.current?.abort();document.removeEventListener("visibilitychange",hide);window.removeEventListener("pagehide",hide);window.removeEventListener("pageshow",hide);};
 },[]);
 useEffect(()=>{if(state.status!=="authenticated"){sequence.current++;request.current?.abort();setSetup(null);setCodes([]);setStatus(null);formRef.current?.reset();}},[state.status]);
 useEffect(()=>{if(!status?.verifiedUntil)return;const timer=window.setTimeout(()=>setStatus(s=>s?{...s,verifiedUntil:null}:s),Math.max(0,Date.parse(status.verifiedUntil)-Date.now()));return()=>window.clearTimeout(timer);},[status?.verifiedUntil]);
 useEffect(()=>{if(!setup)return;const timer=window.setTimeout(()=>{setSetup(null);setMessage("Authenticator setup expired. Start again if needed.");},Math.max(0,Date.parse(setup.expiresAt)-Date.now()));return()=>window.clearTimeout(timer);},[setup?.deviceId,setup?.expiresAt]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const form=event.currentTarget;if(pending||retry.seconds||!form.reportValidity())return;
  const data=new FormData(form),get=(key:string)=>String(data.get(key)??""),version=++sequence.current,controller=new AbortController();request.current=controller;
  let path:string,body:Record<string,string>;
  if(setup){path="enrollment/confirm";body={deviceId:setup.deviceId,code:get("code")};}
  else if(mode==="enroll"){path="enrollment";body={password:get("password"),...(get("activationKey")?{activationKey:get("activationKey")}: {})};}
  else if(mode==="recover"){path="recover";body={password:get("password"),recoveryCode:get("recoveryCode")};}
  else if(mode==="codes"){path="recovery-codes";body={password:get("password")};}
  else if(mode==="revoke"){path="devices/"+encodeURIComponent(get("deviceId"))+"/revoke";body={password:get("password")};}
  else{path="verify";body={password:get("password"),deviceId:get("deviceId"),code:get("code")};}
  setPending(true);setError("");setMessage("");
  try{
   const result=await apiJson<unknown>("/auth/staff-mfa/"+path,{method:"POST",json:body,signal:controller.signal});
   if(version!==sequence.current)return;
   if(mode==="revoke"&&!setup){setCodes([]);setSetup(null);clearUser();return;}
   if(path==="enrollment"){
    const value=result as Setup;if(!value||typeof value.deviceId!=="string"||!/^[A-Z2-7]{32}$/.test(value.secret??"")||!Number.isFinite(Date.parse(value.expiresAt)))throw new Error("Invalid setup response");setSetup(value);setMessage("Add the setup key to your authenticator, then enter its six-digit code.");
   }else{
    const value=result as {recoveryCodes?:unknown};
    if(value?.recoveryCodes!==undefined){if(!Array.isArray(value.recoveryCodes)||value.recoveryCodes.length!==8||value.recoveryCodes.some(c=>typeof c!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(c)))throw new Error("Invalid recovery response");setCodes(value.recoveryCodes as string[]);}
    setSetup(null);setMessage(path==="recover"?"Recovery accepted. Enroll a new authenticator to restore staff access.":"Staff security updated. Verification lasts for at most five minutes.");
    if(path==="recover")setMode("enroll");await refresh();await read();
   }
  }catch(e){
   if(version!==sequence.current)return;retry.fromError(e);
   if(e instanceof ApiError&&e.status===401){clearUser();return;}
   setError(e instanceof ApiError&&e.status===429?"Too many attempts. Wait before trying again.":e instanceof ApiError&&e.status===403?"Verification failed. Check your credentials and use a fresh code.":e instanceof ApiError&&e.status===409?"Setup is already pending or the device changed. Refresh status before continuing.":"The outcome could not be confirmed. Refresh status before another attempt.");
  }finally{form.reset();if(version===sequence.current)setPending(false);}
 }
 if(state.status==="checking")return <LoadingState label="Checking your session…"/>;
 if(!authenticated)return <Notice title="Staff sign-in required">{state.status==="unavailable"?"Your session could not be confirmed. Try checking again.":"Use a provisioned staff account to manage authenticators."} <Link href="/login?next=/staff-security">Sign in</Link><Button variant="quiet" onClick={()=>void refresh()}>Check session</Button></Notice>;
 if(!visible)return <Notice title="Sensitive values hidden">Return to this tab to check staff security.</Notice>;
 const disabled=pending||retry.seconds>0||loading;
 const action=setup?"Confirm authenticator":mode==="enroll"?"Create setup key":mode==="recover"?"Use recovery code":mode==="codes"?"Replace recovery codes":mode==="revoke"?"Revoke authenticator and sign out":"Verify staff access";
 return <div className="stack">
  <h2 className="auth-form-title">Authenticator security</h2>
  <p>Use an authenticator app for sensitive staff work. A staff role alone does not grant access.</p>
  {loading&&<LoadingState label="Checking staff security…"/>}
  {error&&<Notice tone="error" title="Staff security needs attention">{error}</Notice>}
  {message&&<Notice title="Security update">{message}</Notice>}
  <Button variant="secondary" disabled={pending||loading} onClick={()=>void read()}>Refresh security status</Button>
  {status&&<>
   <p className="small">{status.verifiedUntil?"Last verified until "+new Date(status.verifiedUntil).toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"})+". The server checks access on every request.":"Staff access is not currently verified."}</p>
   {!!codes.length&&<section className="stack" aria-label="Save your recovery codes"><h3>Save these recovery codes</h3><p>Store them in your password manager now. They are shown once. Using one revokes existing authenticators and starts a restricted recovery flow.</p><ul className="mfa-codes">{codes.map(c=><li key={c}><code translate="no">{c}</code></li>)}</ul><Button variant="secondary" onClick={()=>setCodes([])}>I have saved the recovery codes</Button></section>}
   {!setup&&<div className="form-actions" aria-label="Choose a security action">{([ ["verify","Verify access"],["enroll","Add authenticator"],["recover","Recover access"],...(status.verifiedUntil?[["codes","Replace recovery codes"],["revoke","Revoke authenticator"]]:[])] as const).map(([value,label])=><Button key={value} variant={mode===value?"primary":"quiet"} disabled={disabled} aria-pressed={mode===value} onClick={()=>{formRef.current?.reset();setMode(value as typeof mode);setError("");setMessage("");}}>{label}</Button>)}</div>}
   {setup&&<section className="stack" aria-label="Set up an authenticator"><h3>Add VERA Match to your authenticator</h3><p>Choose a time-based code: six digits, a 30-second period and SHA-1. Setup expires at {new Date(setup.expiresAt).toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"})}.</p>{setup.secret?<Input label="One-time setup key" name="setup-secret" value={setup.secret} translate="no" readOnly autoComplete="off" spellCheck={false}/>:<Notice title="Setup key is hidden">If you already added it to your app, enter its code. Otherwise wait for setup to expire and start again.</Notice>}</section>}
   {mode==="recover"&&!setup&&<Notice tone="warning" title="Recovery replaces your authenticators">Existing sessions and authenticators will be revoked. You must confirm a new authenticator before sensitive staff work.</Notice>}
   {mode==="codes"&&!setup&&<Notice tone="warning" title="Old recovery codes stop working">Save the replacement codes as soon as they appear. Previously saved codes cannot be used afterward.</Notice>}
   {mode==="revoke"&&!setup&&<Notice tone="warning" title="This signs you out everywhere">The selected authenticator stops working immediately. Keep another authenticator or saved recovery codes before continuing.</Notice>}
   <Form ref={formRef} onSubmit={submit} aria-label={action}>
    {!setup&&<Input label="Current password" name="password" type="password" autoComplete="current-password" maxLength={1024} required disabled={disabled}/>}
    {!setup&&(mode==="verify"||mode==="revoke")&&<Select label="Authenticator" name="deviceId" required disabled={disabled||!status.devices.length} defaultValue={status.devices[0]?.id??""}>{!status.devices.length&&<option value="">No active authenticator</option>}{status.devices.map((d,index)=><option key={d.id} value={d.id}>Authenticator {index+1} · {new Date(d.activatedAt).toLocaleDateString("en")}</option>)}</Select>}
    {(setup||mode==="verify")&&<Input label="Authenticator code" name="code" autoComplete="one-time-code" inputMode="numeric" spellCheck={false} autoCapitalize="none" pattern="[0-9]{6}" minLength={6} maxLength={6} hint="Enter the six digits currently shown in your authenticator." required disabled={disabled}/>}
    {!setup&&mode==="enroll"&&!status.verifiedUntil&&!status.recoveryEnrollmentAllowed&&<Input label="Staff activation key" name="activationKey" type="password" autoComplete="off" minLength={43} maxLength={43} hint="Use the separate activation key provided by your authorized administrator." required disabled={disabled}/>}
    {!setup&&mode==="recover"&&<Input label="Recovery code" name="recoveryCode" type="password" autoComplete="off" minLength={43} maxLength={43} required disabled={disabled}/>}
    <FormActions><Button type="submit" variant={mode==="revoke"&&!setup?"danger":"primary"} loading={pending} loadingLabel="Updating security…" disabled={disabled||(!setup&&(mode==="verify"||mode==="revoke")&&!status.devices.length)} aria-describedby={retry.seconds?"mfa-wait":undefined}>{action}</Button></FormActions>
    <RetryAfterFeedback id="mfa-wait" seconds={retry.seconds}/>
   </Form>
  </>}
 </div>;
}
