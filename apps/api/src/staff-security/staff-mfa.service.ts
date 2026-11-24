import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { Prisma, type Session, type StaffIdentity } from "@prisma/client";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AuthContext } from "../auth/auth-context";
import { AuthRateLimitException } from "../auth/auth-rate-limit.exception";
import { PasswordService } from "../auth/password.service";
import { hashSessionToken } from "../auth/session-token";
import { PrismaService } from "../database/prisma.service";
import { StaffAuthority } from "./staff-authority";
import { StaffIdentityService, staffDatabaseNow } from "./staff-identity.service";
import { StaffMfaKeyring } from "./staff-mfa-keyring";
import { encodeTotpSecret, matchingTotpCounter, newRecoveryCodes, newTotpSecret, recoveryCodeHash, staffEnrollmentKeyHash } from "./mfa-crypto";

type Access={identity:StaffIdentity,session:Session,passwordHash:string,now:Date,charged?:boolean};
type Failure={failure:"MFA_FAILED"};
const failed=():Failure=>({failure:"MFA_FAILED"});
const denied=():never=>{throw new ForbiddenException({code:"STAFF_MFA_REQUIRED",message:"Current verified staff assurance is required."});};
const conflict=():never=>{throw new ConflictException({code:"STAFF_MFA_STATE_CONFLICT",message:"Review the current device state before trying again."});};
const binding=(identity:StaffIdentity,id:string)=>JSON.stringify([identity.subjectId,id,identity.mfaEpoch.toString()]);
export function mfaObject(input:unknown,keys:string[]):Record<string,unknown>{
 if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))throw new BadRequestException({code:"VALIDATION_FAILED",message:"Use the documented MFA fields."}); return input as Record<string,unknown>;
}
function text(value:unknown,max:number):string{if(typeof value!=="string"||!value.length||Buffer.byteLength(value)>max)throw new BadRequestException({code:"VALIDATION_FAILED",message:"An MFA field is invalid."});return value;}
function deviceId(value:unknown):string{const id=text(value,36);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new BadRequestException({code:"VALIDATION_FAILED",message:"Use a valid device reference."});return id;}

@Injectable()
export class StaffMfaService{
 constructor(private readonly prisma:PrismaService,private readonly identities:StaffIdentityService,private readonly authority:StaffAuthority,private readonly keys:StaffMfaKeyring,private readonly passwords:PasswordService,private readonly journal?:RecoveryJournalService){}
 private async run<T>(auth:AuthContext,operation:(tx:Prisma.TransactionClient,access:Access)=>Promise<T|Failure>):Promise<T>{
  const result=await this.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${auth.user.id} FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${auth.sessionId} FOR UPDATE`;
   await tx.$queryRaw`SELECT "userId" FROM "StaffIdentity" WHERE "userId"=${auth.user.id} FOR UPDATE`;
   const now=await staffDatabaseNow(tx),user=await tx.user.findUnique({where:{id:auth.user.id}}),session=await tx.session.findUnique({where:{id:auth.sessionId}});
   if(!user||!session||session.userId!==user.id||session.revokedAt||session.expiresAt<=now||user.status!=="ACTIVE"||!user.emailVerifiedAt)throw new UnauthorizedException({code:"SESSION_REQUIRED",message:"Sign in again."});
   const identity=await this.identities.current(tx,user.id,now); if(!identity)return denied();
   this.keys.box;
   const access:Access={identity,session,passwordHash:user.passwordHash,now};
   const result=await operation(tx,access);
   if(access.charged && !(result && typeof result === "object" && "failure" in result))await tx.staffMfaAttemptWindow.updateMany({where:{subjectId:identity.subjectId},data:{attempts:0}});
   return result;
  },{timeout:15000});
  // Invalid factors consume durable quota even though the public request fails.
  if(result&&typeof result==="object"&&"failure" in result)throw new ForbiddenException({code:"STAFF_MFA_FAILED",message:"MFA could not be verified."});
  return result as T;
 }
 private async charge(tx:Prisma.TransactionClient,a:Access){
  a.charged=true;
  const old=await tx.staffMfaAttemptWindow.findUnique({where:{subjectId:a.identity.subjectId}});
  const expired=!old||a.now.getTime()-old.startedAt.getTime()>=900000;
  if(!expired&&old.attempts>=5)throw new AuthRateLimitException(Math.max(1,Math.ceil((old.startedAt.getTime()+900000-a.now.getTime())/1000)));
  await tx.staffMfaAttemptWindow.upsert({where:{subjectId:a.identity.subjectId},create:{subjectId:a.identity.subjectId,startedAt:a.now,attempts:1},update:expired?{startedAt:a.now,attempts:1}:{attempts:{increment:1}}});
 }
 private async event(tx:Prisma.TransactionClient,a:Access,kind:string,id?:string){
  await this.journal?.record(tx,[a.identity.userId],"STAFF_RESTRICTION");
  await tx.staffMfaEvent.create({data:{subjectId:a.identity.subjectId,identityRevision:a.identity.revision,mfaEpoch:a.identity.mfaEpoch,kind,deviceId:id}});
  await tx.auditLog.create({data:{actorId:a.identity.userId,action:"STAFF_"+kind,subjectType:"StaffIdentity",subjectId:a.identity.subjectId}});
 }
 async resolve(tx:Prisma.TransactionClient,auth:AuthContext){
  const now=await staffDatabaseNow(tx),identity=await this.identities.current(tx,auth.user.id,now);
  if(!identity)return undefined;
  const proof=await tx.staffMfaProof.findUnique({where:{sessionId:auth.sessionId},include:{session:true,device:true}});
  if(!proof||proof.subjectId!==identity.subjectId||proof.identityRevision!==identity.revision||proof.mfaEpoch!==identity.mfaEpoch||proof.session.userId!==auth.user.id||proof.session.revokedAt||proof.session.expiresAt<=now||proof.verifiedAt>now||proof.expiresAt<=now||proof.expiresAt>proof.session.expiresAt||proof.expiresAt>identity.expiresAt||proof.expiresAt.getTime()-proof.verifiedAt.getTime()>300000||proof.device.subjectId!==identity.subjectId||proof.device.mfaEpoch!==identity.mfaEpoch||proof.device.state!=="ACTIVE"||!proof.device.activatedAt||proof.device.revokedAt)return undefined;
  try{const secret=this.keys.box.open(proof.device.secretEnvelope,binding(identity,proof.deviceId));secret.fill(0);}catch{return undefined;}
  return {userId:auth.user.id,sessionId:auth.sessionId,level:"MFA" as const,verifiedAt:proof.verifiedAt,expiresAt:proof.expiresAt,testOnly:false};
 }
 async status(auth:AuthContext){return this.run(auth,async(tx,a)=>{
  const proof=await this.resolve(tx,auth); const devices=await tx.staffMfaDevice.findMany({where:{subjectId:a.identity.subjectId,mfaEpoch:a.identity.mfaEpoch,state:"ACTIVE"},select:{id:true,createdAt:true,activatedAt:true},orderBy:{id:"asc"}});
  const permit=await tx.staffMfaRecoveryPermit.findUnique({where:{sessionId:auth.sessionId}});
  const pending=await tx.staffMfaDevice.findFirst({where:{subjectId:a.identity.subjectId,mfaEpoch:a.identity.mfaEpoch,state:"PENDING",enrollmentSessionId:auth.sessionId,pendingExpiresAt:{gt:a.now}},select:{id:true,pendingExpiresAt:true}});
  return {pendingEnrollment:pending?{deviceId:pending.id,expiresAt:pending.pendingExpiresAt}:null,devices,verifiedUntil:proof?.expiresAt??null,recoveryEnrollmentAllowed:!!permit&&!permit.consumedAt&&permit.expiresAt>a.now&&permit.identityRevision===a.identity.revision&&permit.mfaEpoch===a.identity.mfaEpoch};
 });}
 private async rotate(tx:Prisma.TransactionClient,a:Access,device?:string){
  await this.journal?.record(tx,[a.identity.userId],"STAFF_RESTRICTION");
  const now=await staffDatabaseNow(tx); if(a.session.expiresAt<=now||a.identity.expiresAt<=now)return denied();
  const token=randomBytes(32).toString("base64url"); const expiresAt=new Date(Math.min(a.session.expiresAt.getTime(),a.identity.expiresAt.getTime()));
  await tx.session.update({where:{id:a.session.id},data:{revokedAt:now}});
  const session=await tx.session.create({data:{userId:a.identity.userId,tokenHash:hashSessionToken(token),expiresAt}});
  const proofExpiry=new Date(Math.min(now.getTime()+300000,expiresAt.getTime()));
  if(device)await tx.staffMfaProof.create({data:{sessionId:session.id,subjectId:a.identity.subjectId,deviceId:device,identityRevision:a.identity.revision,mfaEpoch:a.identity.mfaEpoch,verifiedAt:now,expiresAt:proofExpiry}});
  return {token,sessionId:session.id,expiresAt,verifiedUntil:device?proofExpiry:null};
 }
 private async codes(tx:Prisma.TransactionClient,a:Access){
  await this.journal?.record(tx,[a.identity.userId],"STAFF_RESTRICTION");
  await tx.staffMfaRecoveryCode.updateMany({where:{subjectId:a.identity.subjectId,mfaEpoch:a.identity.mfaEpoch,consumedAt:null},data:{consumedAt:a.now}});
  const entries=newRecoveryCodes(); await tx.staffMfaRecoveryCode.createMany({data:entries.map(x=>({hash:x.hash,subjectId:a.identity.subjectId,mfaEpoch:a.identity.mfaEpoch}))});return entries.map(x=>x.code);
 }
 async enroll(auth:AuthContext,input:unknown){
  const b=mfaObject(input,["password","activationKey"]),password=text(b.password,1024),activation=b.activationKey===undefined?undefined:text(b.activationKey,43);
  return this.run(auth,async(tx,a)=>{
   await this.charge(tx,a); if(!await this.passwords.verify(a.passwordHash,password))return failed();
   const where={subjectId:a.identity.subjectId,mfaEpoch:a.identity.mfaEpoch};
   const prior=await tx.staffMfaDevice.count({where:{...where,activatedAt:{not:null}}});
   const proof=await this.resolve(tx,auth),permit=await tx.staffMfaRecoveryPermit.findUnique({where:{sessionId:auth.sessionId}});
   const recovery=permit&&!permit.consumedAt&&permit.subjectId===a.identity.subjectId&&permit.identityRevision===a.identity.revision&&permit.mfaEpoch===a.identity.mfaEpoch&&permit.expiresAt>a.now;
   if(!proof&&!recovery){
    if(prior)return failed();
    const event=await tx.staffTrustEvent.findUniqueOrThrow({where:{directiveId:a.identity.currentDirectiveId}}),directive=this.authority.verify(event.signedDirective,a.now);
    const hash=activation&&staffEnrollmentKeyHash(activation);
    if(!hash||!directive.enrollmentKeyHash||!timingSafeEqual(Buffer.from(hash),Buffer.from(directive.enrollmentKeyHash)))return failed();
   }
   if(await tx.staffMfaDevice.count({where:{...where,state:"ACTIVE"}})>=5)return conflict();
   if(await tx.staffMfaDevice.count({where:{...where,state:"PENDING",pendingExpiresAt:{gt:a.now}}}))return conflict();
   await this.journal?.record(tx,[a.identity.userId],"STAFF_RESTRICTION");
   await tx.staffMfaDevice.updateMany({where:{...where,state:"PENDING"},data:{state:"REVOKED",revokedAt:a.now}});
   const id=randomUUID(),secret=newTotpSecret(),expiresAt=new Date(Math.min(a.now.getTime()+300000,a.session.expiresAt.getTime(),a.identity.expiresAt.getTime()));
   try{
    await tx.staffMfaDevice.create({data:{id,...where,enrollmentSessionId:auth.sessionId,secretEnvelope:this.keys.box.seal(secret,binding(a.identity,id)),pendingExpiresAt:expiresAt}});
    if(recovery)await tx.staffMfaRecoveryPermit.update({where:{sessionId:auth.sessionId},data:{consumedAt:a.now}});
    await this.event(tx,a,"ENROLLMENT_STARTED",id);
    return {deviceId:id,secret:encodeTotpSecret(secret),expiresAt,issuer:"VERA Match",digits:6,periodSeconds:30};
   }finally{secret.fill(0);}
  });
 }
 async confirm(auth:AuthContext,input:unknown){
  const b=mfaObject(input,["deviceId","code"]),id=deviceId(b.deviceId),code=text(b.code,6);
  return this.run(auth,async(tx,a)=>{
   await this.charge(tx,a); await tx.$queryRaw`SELECT id FROM "StaffMfaDevice" WHERE id=${id}::uuid AND "subjectId"=${a.identity.subjectId}::uuid FOR UPDATE`;
   const device=await tx.staffMfaDevice.findUnique({where:{id}});
   if(!device||device.subjectId!==a.identity.subjectId||device.mfaEpoch!==a.identity.mfaEpoch||device.state!=="PENDING"||device.enrollmentSessionId!==auth.sessionId||device.pendingExpiresAt<=a.now)return failed();
   const secret=this.keys.box.open(device.secretEnvelope,binding(a.identity,id)); let counter:bigint|undefined;
   try{counter=matchingTotpCounter(secret,code,a.now.getTime(),device.lastCounter);}finally{secret.fill(0);}
   if(counter===undefined)return failed();
   const now=await staffDatabaseNow(tx);if(device.pendingExpiresAt<=now)return failed();
   await tx.staffMfaDevice.update({where:{id},data:{state:"ACTIVE",activatedAt:now,lastCounter:counter}});
   const result=await this.rotate(tx,a,id);
   const existing=await tx.staffMfaRecoveryCode.count({where:{subjectId:a.identity.subjectId,mfaEpoch:a.identity.mfaEpoch,consumedAt:null}});
   const recoveryCodes=existing?undefined:await this.codes(tx,a);
   await this.event(tx,a,"DEVICE_CONFIRMED",id); return {...result,recoveryCodes};
  });
 }
 async verify(auth:AuthContext,input:unknown){
  const b=mfaObject(input,["deviceId","code","password"]),id=deviceId(b.deviceId),code=text(b.code,6),password=text(b.password,1024);
  return this.run(auth,async(tx,a)=>{
   await this.charge(tx,a); if(!await this.passwords.verify(a.passwordHash,password))return failed();
   await tx.$queryRaw`SELECT id FROM "StaffMfaDevice" WHERE id=${id}::uuid AND "subjectId"=${a.identity.subjectId}::uuid FOR UPDATE`; const d=await tx.staffMfaDevice.findUnique({where:{id}});
   if(!d||d.subjectId!==a.identity.subjectId||d.mfaEpoch!==a.identity.mfaEpoch||d.state!=="ACTIVE"||d.revokedAt)return failed();
   const now=await staffDatabaseNow(tx),secret=this.keys.box.open(d.secretEnvelope,binding(a.identity,id));let counter:bigint|undefined;
   try{counter=matchingTotpCounter(secret,code,now.getTime(),d.lastCounter);}finally{secret.fill(0);}
   if(counter===undefined)return failed();
   const change=await tx.staffMfaDevice.updateMany({where:{id,lastCounter:d.lastCounter},data:{lastCounter:counter}});if(change.count!==1)return failed();
   const result=await this.rotate(tx,a,id);await this.event(tx,a,"MFA_VERIFIED",id);return result;
  });
 }
 async recover(auth:AuthContext,input:unknown){
  const b=mfaObject(input,["password","recoveryCode"]),password=text(b.password,1024),code=text(b.recoveryCode,43);
  return this.run(auth,async(tx,a)=>{
   await this.charge(tx,a);if(!await this.passwords.verify(a.passwordHash,password))return failed();const hash=recoveryCodeHash(code);if(!hash)return failed();
   const recovery=await tx.staffMfaRecoveryCode.findUnique({where:{hash}});
   if(!recovery||recovery.subjectId!==a.identity.subjectId||recovery.mfaEpoch!==a.identity.mfaEpoch||recovery.consumedAt)return failed();
   await tx.staffMfaRecoveryCode.updateMany({where:{subjectId:a.identity.subjectId,mfaEpoch:a.identity.mfaEpoch,consumedAt:null},data:{consumedAt:a.now}});
   await tx.staffMfaDevice.updateMany({where:{subjectId:a.identity.subjectId,state:{not:"REVOKED"}},data:{state:"REVOKED",revokedAt:a.now}});
   // Every old browser session loses access; the new session only permits enrollment.
   await tx.session.updateMany({where:{userId:a.identity.userId,revokedAt:null},data:{revokedAt:a.now}});
   const result=await this.rotate(tx,a);
   const expiresAt=new Date(Math.min(a.now.getTime()+300000,result.expiresAt.getTime()));
   await tx.staffMfaRecoveryPermit.create({data:{sessionId:result.sessionId,subjectId:a.identity.subjectId,identityRevision:a.identity.revision,mfaEpoch:a.identity.mfaEpoch,expiresAt}});
   await this.event(tx,a,"RECOVERY_CONSUMED");return {...result,recoveryExpiresAt:expiresAt};
  });
 }
 async rotateCodes(auth:AuthContext,input:unknown){
  const b=mfaObject(input,["password"]),password=text(b.password,1024);
  return this.run(auth,async(tx,a)=>{await this.charge(tx,a);if(!await this.passwords.verify(a.passwordHash,password))return failed();if(!await this.resolve(tx,auth))return failed();const recoveryCodes=await this.codes(tx,a);await this.event(tx,a,"RECOVERY_CODES_ROTATED");return {recoveryCodes};});
 }
 async revoke(auth:AuthContext,value:unknown,input:unknown){
  const id=deviceId(value),b=mfaObject(input,["password"]),password=text(b.password,1024);
  return this.run(auth,async(tx,a)=>{await this.charge(tx,a);if(!await this.passwords.verify(a.passwordHash,password)||!await this.resolve(tx,auth))return failed();const device=await tx.staffMfaDevice.findUnique({where:{id}});if(!device||device.subjectId!==a.identity.subjectId||device.mfaEpoch!==a.identity.mfaEpoch||device.state!=="ACTIVE")return failed();await tx.staffMfaDevice.update({where:{id},data:{state:"REVOKED",revokedAt:a.now}});await tx.session.updateMany({where:{userId:a.identity.userId,revokedAt:null},data:{revokedAt:a.now}});await this.event(tx,a,"DEVICE_REVOKED",id);return {revoked:true};});
 }
}
