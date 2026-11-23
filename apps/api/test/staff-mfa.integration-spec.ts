import { StaffMfaKeyring } from "../src/staff-security/staff-mfa-keyring";
import { StaffMfaKeyRotationService } from "../src/staff-security/staff-mfa-key-rotation.service";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/configure-app";
import { parseEnvironment } from "../src/config/environment";
import { EnvironmentService } from "../src/config/environment.service";
import { PrismaService } from "../src/database/prisma.service";
import { PasswordService } from "../src/auth/password.service";
import { SessionService } from "../src/auth/session.service";
import { StaffIdentityService } from "../src/staff-security/staff-identity.service";
import { StaffMfaService } from "../src/staff-security/staff-mfa.service";
import { staffDirectiveMessage, staffEmailDigest, type StaffDirective } from "../src/staff-security/staff-directive";
import { decodeTotpSecret, hotp, staffEnrollmentKeyHash } from "../src/staff-security/mfa-crypto";
import { createAuthDatabase } from "./disposable-auth-database";

describe("C064 real TOTP / HTTP / PostgreSQL (no assurance override)",()=>{
 let db:Awaited<ReturnType<typeof createAuthDatabase>>,app:INestApplication,base:string,directory:string,keyPath:string,boxPath:string;
 const authority=generateKeyPairSync("ed25519"),origin="http://localhost:3000",password="Synthetic staff test password 2026!";
 const wire=(p:StaffDirective)=>JSON.stringify({payload:p,signature:sign(null,staffDirectiveMessage(p),authority.privateKey).toString("base64url")});
 async function start(){
  const override=jest.replaceProperty(process,"env",{...process.env,STAFF_AUTHORITY_KEYS_PATH:keyPath,STAFF_MFA_KEYRING_PATH:boxPath});
  try{
   const values=parseEnvironment({...process.env,NODE_ENV:"test",DATABASE_URL:db.url,CORS_ORIGIN:origin});
   const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(EnvironmentService).useValue({values}).overrideProvider(PrismaService).useValue(db.client).compile();
   app=module.createNestApplication({logger:false});configureApplication(app);await app.listen(0,"127.0.0.1");base=await app.getUrl();
  }finally{override.restore();}
 }
 beforeAll(async()=>{
  db=await createAuthDatabase();directory=mkdtempSync(join(tmpdir(),"vera-mfa-http-"));keyPath=join(directory,"authority.json");boxPath=join(directory,"wrapping.json");
  writeFileSync(keyPath,JSON.stringify({schemaVersion:1,keys:[{id:"synthetic-root",publicKeyPem:authority.publicKey.export({type:"spki",format:"pem"}).toString()}]}),{mode:0o600});
  writeFileSync(boxPath,JSON.stringify({schemaVersion:1,activeKeyId:"synthetic-wrap",keys:[{id:"synthetic-wrap",keyBase64url:randomBytes(32).toString("base64url")}]}),{mode:0o600});
  await start();
 },60000);
 afterAll(async()=>{await app?.close();await db?.close();if(keyPath)unlinkSync(keyPath);if(boxPath)unlinkSync(boxPath);if(directory)rmdirSync(directory);});
 const request=(cookie:string,path:string,body?:unknown)=>fetch(base+"/api/"+path,{method:body===undefined?"GET":"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
 const mfa=(cookie:string,path="",body?:unknown)=>request(cookie,"auth/staff-mfa"+(path?"/"+path:""),body);
 const cookie=(response:Response)=>response.headers.get("set-cookie")!.split(";")[0];
 async function login(email:string){const response=await request("","auth/login",{email,password});expect(response.status).toBe(200);return cookie(response);}
 async function fixture(role:"MODERATOR"|"ADMIN"|"EXPERT"="MODERATOR"){
  const user=await db.client.user.create({data:{email:randomUUID()+"@example.invalid",passwordHash:await app.get(PasswordService).hash(password),status:"ACTIVE",emailVerifiedAt:new Date()}});
  const activationKey=randomBytes(32).toString("base64url");
  const p:StaffDirective={schemaVersion:1,directiveId:randomUUID(),authorityKeyId:"synthetic-root",subjectId:randomUUID(),userId:user.id,emailDigest:staffEmailDigest(user.email),role,state:"ACTIVE",revision:1,mfaEpoch:1,enrollmentKeyHash:staffEnrollmentKeyHash(activationKey)!,permissions:[],issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
  await app.get(StaffIdentityService).apply(wire(p));return {user,p,activationKey,cookie:await login(user.email)};
 }
 const code=(secret:string,offset=0n)=>hotp(decodeTotpSecret(secret),BigInt(Math.floor(Date.now()/30000))+offset);
 async function enrolled(){
  const f=await fixture();const setup=await mfa(f.cookie,"enrollment",{password,activationKey:f.activationKey});expect(setup.status).toBe(201);const d=await setup.json() as {deviceId:string,secret:string};
  const submittedCode=code(d.secret);const response=await mfa(f.cookie,"enrollment/confirm",{deviceId:d.deviceId,code:submittedCode});expect(response.status).toBe(200);
  return {...f,...d,submittedCode,elevated:cookie(response),result:await response.json() as {recoveryCodes:string[],verifiedUntil:string}};
 }
 async function auth(c:string){return app.get(SessionService).resolve(c.slice(c.indexOf("=")+1));}
 it("rejects missing sessions, role-only staff and invalid activation capability",async()=>{
  expect((await mfa("")).status).toBe(401);
  const f=await fixture();await db.client.staffIdentity.findUniqueOrThrow({where:{userId:f.user.id}});
  const other=await db.client.user.create({data:{email:randomUUID()+"@example.invalid",passwordHash:await app.get(PasswordService).hash(password),status:"ACTIVE",role:"MODERATOR",emailVerifiedAt:new Date()}});
  expect((await mfa(await login(other.email))).status).toBe(403);
  expect((await mfa(f.cookie,"enrollment",{password,activationKey:randomBytes(32).toString("base64url")})).status).toBe(403);
  expect(await db.client.staffMfaDevice.count({where:{subjectId:f.p.subjectId}})).toBe(0);
 });
 it("uses an actual TOTP factor, rotates session ID, returns no bearer token and unlocks moderator access",async()=>{
  const f=await enrolled();expect(f.result.recoveryCodes).toHaveLength(8);expect(f.result.verifiedUntil).toBeDefined();
  expect((await request(f.cookie,"moderation/reports")).status).toBe(401);
  expect((await request(f.elevated,"moderation/reports")).status).toBe(200);
  const context=(await auth(f.elevated))!; const proof=await db.client.$transaction(tx=>app.get(StaffMfaService).resolve(tx,context));
  expect(proof).toMatchObject({userId:f.user.id,sessionId:context.sessionId,testOnly:false,level:"MFA"});
  const state=await db.client.staffMfaDevice.findUniqueOrThrow({where:{id:f.deviceId}});expect(state.secretEnvelope).not.toContain(f.secret);
  const status=await mfa(f.elevated);expect(status.headers.get("cache-control")).toContain("no-store");const body=await status.text();expect(body).not.toContain(f.secret);expect(body).not.toContain("token");
  expect((await mfa(f.elevated,"verify",{password,deviceId:f.deviceId,code:f.submittedCode})).status).toBe(403);
  const response=await mfa(f.elevated,"verify",{password,deviceId:f.deviceId,code:code(f.secret,1n)});expect(response.status).toBe(200);expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(await response.text()).not.toMatch(/token|sessionId|secret|recoveryCodes/);expect(await auth(f.elevated)).toBeNull();
 });
 it("binds setup confirmation to the exact initiating session and owner",async()=>{
  const f=await fixture(),second=await login(f.user.email);const setup=await mfa(f.cookie,"enrollment",{password,activationKey:f.activationKey});const d=await setup.json() as {deviceId:string,secret:string};
  expect((await mfa(second,"enrollment/confirm",{deviceId:d.deviceId,code:code(d.secret)})).status).toBe(403);
  const other=await fixture();expect((await mfa(other.cookie,"enrollment/confirm",{deviceId:d.deviceId,code:code(d.secret)})).status).toBe(403);
  expect((await mfa(f.cookie,"enrollment/confirm",{deviceId:d.deviceId,code:code(d.secret)})).status).toBe(200);
 });
 it("consumes a TOTP counter once across concurrent genuine sessions",async()=>{
  const f=await enrolled(),a=await login(f.user.email),b=await login(f.user.email),otp=code(f.secret,1n);
  const results=await Promise.all([mfa(a,"verify",{password,deviceId:f.deviceId,code:otp}),mfa(b,"verify",{password,deviceId:f.deviceId,code:otp})]);
  expect(results.map(r=>r.status).sort()).toEqual([200,403]);
 });
 it("preserves durable failed-factor throttling after a fresh application instance",async()=>{
  const f=await enrolled();const valid=new Set([-2n,-1n,0n,1n,2n].map(offset=>code(f.secret,offset)));let bad="000000";while(valid.has(bad))bad=(Number(bad)+1).toString().padStart(6,"0");
  for(let i=0;i<5;i++)expect((await mfa(f.elevated,"verify",{password,deviceId:f.deviceId,code:bad})).status).toBe(403);
  await app.close();await start();const response=await mfa(f.elevated,"verify",{password,deviceId:f.deviceId,code:code(f.secret,1n)});
  expect(response.status).toBe(429);expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);expect(await response.json()).toMatchObject({code:"RATE_LIMITED"});
 });
 it("recovery consumes codes, revokes old sessions/devices and permits enrollment without MFA assurance",async()=>{
  const f=await enrolled();const response=await mfa(f.elevated,"recover",{password,recoveryCode:f.result.recoveryCodes[0]});expect(response.status).toBe(200);const recovered=cookie(response);
  expect(await auth(f.elevated)).toBeNull();expect((await request(recovered,"moderation/reports")).status).toBe(403);
  expect((await mfa(recovered)).status).toBe(200);expect((await db.client.staffMfaDevice.findUniqueOrThrow({where:{id:f.deviceId}})).state).toBe("REVOKED");
  expect((await mfa(recovered,"recover",{password,recoveryCode:f.result.recoveryCodes[0]})).status).toBe(403);
  expect((await mfa(recovered,"recover",{password,recoveryCode:f.result.recoveryCodes[1]})).status).toBe(403);
  const setup=await mfa(recovered,"enrollment",{password});expect(setup.status).toBe(201);const d=await setup.json() as {deviceId:string,secret:string};
  expect((await request(recovered,"moderation/reports")).status).toBe(403);
  const confirmed=await mfa(recovered,"enrollment/confirm",{deviceId:d.deviceId,code:code(d.secret)});expect(confirmed.status).toBe(200);expect((await confirmed.json() as {recoveryCodes:string[]}).recoveryCodes).toHaveLength(8);
  expect((await request(cookie(confirmed),"moderation/reports")).status).toBe(200);
 });
 it("never lets ADMIN inherit moderation merely by completing real MFA",async()=>{
  const f=await fixture("ADMIN"),setup=await mfa(f.cookie,"enrollment",{password,activationKey:f.activationKey}),d=await setup.json() as {deviceId:string,secret:string};
  const response=await mfa(f.cookie,"enrollment/confirm",{deviceId:d.deviceId,code:code(d.secret)});expect(response.status).toBe(200);expect((await request(cookie(response),"moderation/reports")).status).toBe(403);
 });
 it("revokes every old proof on deprovisioning and requires a fresh epoch on reactivation",async()=>{
  const f=await enrolled();const revoke={...f.p,directiveId:randomUUID(),revision:2,state:"REVOKED" as const,enrollmentKeyHash:null};await app.get(StaffIdentityService).apply(wire(revoke));
  expect(await auth(f.elevated)).toBeNull();const activation=randomBytes(32).toString("base64url");const next={...f.p,directiveId:randomUUID(),revision:3,mfaEpoch:2,enrollmentKeyHash:staffEnrollmentKeyHash(activation)!};await app.get(StaffIdentityService).apply(wire(next));
  const current=await login(f.user.email);expect((await request(current,"moderation/reports")).status).toBe(403);expect((await mfa(current,"verify",{password,deviceId:f.deviceId,code:code(f.secret,1n)})).status).toBe(403);
  expect((await mfa(current,"enrollment",{password,activationKey:f.activationKey})).status).toBe(403);expect((await mfa(current,"enrollment",{password,activationKey:activation})).status).toBe(201);
 });
 it("rolls back factor consumption, session elevation and audit together",async()=>{
  const f=await fixture(),setup=await mfa(f.cookie,"enrollment",{password,activationKey:f.activationKey}),d=await setup.json() as {deviceId:string,secret:string};
  const audit=jest.spyOn(db.client,"$transaction").mockImplementationOnce(async(operation:any)=>{audit.mockRestore();return db.client.$transaction(async tx=>operation(new Proxy(tx,{get(target,property,receiver){if(property==="auditLog")return{create:async()=>{throw new Error("SYNTHETIC_AUDIT_FAILURE");}};return Reflect.get(target,property,receiver);}})));});
  try{expect((await mfa(f.cookie,"enrollment/confirm",{deviceId:d.deviceId,code:code(d.secret)})).status).toBe(500);}finally{audit.mockRestore();}
  expect((await db.client.staffMfaDevice.findUniqueOrThrow({where:{id:d.deviceId}})).state).toBe("PENDING");expect(await auth(f.cookie)).not.toBeNull();
  expect((await mfa(f.cookie,"enrollment/confirm",{deviceId:d.deviceId,code:code(d.secret)})).status).toBe(200);
 });
 it("expires assurance independently of a still-valid login and retains immutable factor history",async()=>{
  const f=await enrolled(),context=(await auth(f.elevated))!;
  await db.client.staffMfaProof.update({where:{sessionId:context.sessionId},data:{verifiedAt:new Date(Date.now()-60000),expiresAt:new Date(Date.now()-1000)}});
  expect((await request(f.elevated,"moderation/reports")).status).toBe(403);expect(await auth(f.elevated)).not.toBeNull();
  await expect(db.client.staffMfaDevice.delete({where:{id:f.deviceId}})).rejects.toThrow();await expect(db.client.$executeRawUnsafe('TRUNCATE "StaffMfaDevice" CASCADE')).rejects.toThrow();await expect(db.client.$executeRawUnsafe('TRUNCATE "StaffMfaEvent"')).rejects.toThrow();
 });
 it("cannot reset the initial enrollment capability by revoking every device",async()=>{
  const f=await enrolled();expect((await mfa(f.elevated,"devices/"+f.deviceId+"/revoke",{password})).status).toBe(204);
  expect(await auth(f.elevated)).toBeNull();const next=await login(f.user.email);
  expect((await mfa(next,"enrollment",{password,activationKey:f.activationKey})).status).toBe(403);
  expect((await mfa(next,"recover",{password,recoveryCode:f.result.recoveryCodes[0]})).status).toBe(200);
 });
 it("clamps assurance and the replacement session to the original session expiry",async()=>{
  const f=await fixture(),context=(await auth(f.cookie))!;const limit=new Date(Date.now()+2500);await db.client.session.update({where:{id:context.sessionId},data:{expiresAt:limit}});
  const setup=await mfa(f.cookie,"enrollment",{password,activationKey:f.activationKey}),d=await setup.json() as {deviceId:string,secret:string};expect(setup.status).toBe(201);
  const confirmed=await mfa(f.cookie,"enrollment/confirm",{deviceId:d.deviceId,code:code(d.secret)});expect(confirmed.status).toBe(200);const elevated=cookie(confirmed),next=(await auth(elevated))!;
  const proof=await db.client.staffMfaProof.findUniqueOrThrow({where:{sessionId:next.sessionId}});expect(proof.expiresAt.getTime()).toBeLessThanOrEqual(limit.getTime());expect((await db.client.session.findUniqueOrThrow({where:{id:next.sessionId}})).expiresAt).toEqual(limit);
 });
 it("rewraps actual stored secrets under an external rotated key without resetting counters or assurance",async()=>{
  const f=await enrolled(),before=await db.client.staffMfaDevice.findUniqueOrThrow({where:{id:f.deviceId}});
  const fs=await import("node:fs");const original=JSON.parse(fs.readFileSync(boxPath,"utf8"));const newKey=randomBytes(32).toString("base64url");
  writeFileSync(boxPath,JSON.stringify({schemaVersion:1,activeKeyId:"synthetic-next",keys:[...original.keys,{id:"synthetic-next",keyBase64url:newKey}]}));
  const env=jest.replaceProperty(process,"env",{...process.env,STAFF_MFA_KEYRING_PATH:boxPath});let rotated:StaffMfaKeyring;try{rotated=new StaffMfaKeyring();}finally{env.restore();}
  const result=await new StaffMfaKeyRotationService(db.client as PrismaService,rotated!).rewrapAll();expect(result.failed).toBe(0);expect(result.updated).toBeGreaterThan(0);
  const after=await db.client.staffMfaDevice.findUniqueOrThrow({where:{id:f.deviceId}});expect(after.lastCounter).toBe(before.lastCounter);expect(after.activatedAt).toEqual(before.activatedAt);expect(after.secretEnvelope).not.toBe(before.secretEnvelope);expect(after.secretEnvelope.split(".")[1]).toBe("synthetic-next");
  writeFileSync(boxPath,JSON.stringify({schemaVersion:1,activeKeyId:"synthetic-next",keys:[{id:"synthetic-next",keyBase64url:newKey}]}));await app.close();await start();
  expect((await request(f.elevated,"moderation/reports")).status).toBe(200);expect((await mfa(f.elevated,"verify",{password,deviceId:f.deviceId,code:code(f.secret,1n)})).status).toBe(200);
 });

});
