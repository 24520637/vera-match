import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthDatabase } from "./disposable-auth-database";
import { StaffAuthority } from "../src/staff-security/staff-authority";
import { StaffIdentityService } from "../src/staff-security/staff-identity.service";
import { staffDirectiveMessage, staffEmailDigest, type StaffDirective } from "../src/staff-security/staff-directive";
import type { PrismaService } from "../src/database/prisma.service";

describe("C064 genuine signed authority / disposable PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>, service: StaffIdentityService;
  let directory: string, keyPath: string;
  const authority = generateKeyPairSync("ed25519");
  const wire = (p:StaffDirective) => JSON.stringify({payload:p,signature:sign(null,staffDirectiveMessage(p),authority.privateKey).toString("base64url")});
  beforeAll(async () => {
    db = await createAuthDatabase(); directory = mkdtempSync(join(tmpdir(),"vera-staff-trust-")); keyPath = join(directory,"root.pub.json");
    writeFileSync(keyPath,JSON.stringify({schemaVersion:1,keys:[{id:"synthetic-root",publicKeyPem:authority.publicKey.export({type:"spki",format:"pem"}).toString()}]}),{mode:0o600});
    const env = jest.replaceProperty(process,"env",{...process.env,STAFF_AUTHORITY_KEYS_PATH:keyPath});
    try { service = new StaffIdentityService(db.client as PrismaService,new StaffAuthority()); } finally { env.restore(); }
  },60000);
  afterAll(async () => { await db?.close(); if(keyPath)unlinkSync(keyPath); if(directory)rmdirSync(directory); });
  async function fixture() {
    const user = await db.client.user.create({data:{email:randomUUID()+"@example.invalid",passwordHash:"SYNTHETIC-NO-LOGIN-HASH",status:"ACTIVE",emailVerifiedAt:new Date()}});
    const session = await db.client.session.create({data:{userId:user.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+3600000)}});
    const p:StaffDirective={schemaVersion:1,directiveId:randomUUID(),authorityKeyId:"synthetic-root",subjectId:randomUUID(),userId:user.id,emailDigest:staffEmailDigest(user.email),role:"MODERATOR",state:"ACTIVE",revision:1,mfaEpoch:1,permissions:[],enrollmentKeyHash:"a".repeat(64),issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
    return {user,session,p};
  }
  it("does not infer staff identity from a role flag or missing authority", async () => {
    const {user} = await fixture(); await db.client.user.update({where:{id:user.id},data:{role:"MODERATOR"}});
    expect(await service.current(db.client,user.id,new Date())).toBeUndefined();
    const env=jest.replaceProperty(process,"env",{...process.env,STAFF_AUTHORITY_KEYS_PATH:undefined});
    try { expect(() => new StaffAuthority().verify("{}",new Date())).toThrow("Trusted staff authority is not configured."); } finally {env.restore();}
  });
  it("binds exact account/email, provisions once and revokes every prior session atomically", async () => {
    const {user,session,p}=await fixture(); const signed=wire(p);
    expect(await service.apply(signed)).toMatchObject({revision:1,replayed:false});
    expect((await db.client.user.findUniqueOrThrow({where:{id:user.id}})).role).toBe("MODERATOR");
    expect((await db.client.session.findUniqueOrThrow({where:{id:session.id}})).revokedAt).not.toBeNull();
    expect(await service.current(db.client,user.id,new Date())).toMatchObject({subjectId:p.subjectId,revision:1n});
    expect(await service.apply(signed)).toMatchObject({revision:1,replayed:true});
    expect(await db.client.staffTrustEvent.count({where:{userId:user.id}})).toBe(1);
    const wrong=await fixture(); wrong.p.emailDigest=staffEmailDigest("other@example.invalid");
    await expect(service.apply(wire(wrong.p))).rejects.toMatchObject({status:403});
    expect(await db.client.staffIdentity.count({where:{userId:wrong.user.id}})).toBe(0);
  });
  it("serializes concurrent identical directives without duplicate evidence", async () => {
    const {user,p}=await fixture(); const signed=wire(p);
    const results=await Promise.all([service.apply(signed),service.apply(signed),service.apply(signed)]);
    expect(results.filter(x=>!x.replayed)).toHaveLength(1); expect(await db.client.staffTrustEvent.count({where:{userId:user.id}})).toBe(1);
  });
  it("rejects stale revisions, subject replacement and enrollment reset through reactivation", async () => {
    const {user,p}=await fixture(); await service.apply(wire(p));
    const revoke={...p,directiveId:randomUUID(),revision:2,state:"REVOKED" as const,enrollmentKeyHash:null}; await service.apply(wire(revoke));
    expect(await service.current(db.client,user.id,new Date())).toBeUndefined();
    await expect(service.apply(wire({...p,directiveId:randomUUID()}))).rejects.toMatchObject({status:409});
    await expect(service.apply(wire({...p,directiveId:randomUUID(),revision:3}))).rejects.toMatchObject({status:409});
    await expect(service.apply(wire({...p,directiveId:randomUUID(),revision:3,mfaEpoch:2,subjectId:randomUUID()}))).rejects.toMatchObject({status:409});
    const next={...p,directiveId:randomUUID(),revision:3,mfaEpoch:2,enrollmentKeyHash:"b".repeat(64)}; await service.apply(wire(next));
    expect(await service.current(db.client,user.id,new Date())).toMatchObject({revision:3n,mfaEpoch:2n});
  });
  it("rolls back the entire provisioning operation when its audit cannot commit", async () => {
    const {user,session,p}=await fixture();
    const audit=jest.spyOn(db.client,"$transaction").mockImplementationOnce(async (operation:any) => {
      audit.mockRestore(); return db.client.$transaction(async tx => operation(new Proxy(tx,{get(target,property,receiver){ if(property === "auditLog") return {create:async()=>{throw new Error("SYNTHETIC_AUDIT_FAILURE");}}; return Reflect.get(target,property,receiver); }})));
    });
    try {await expect(service.apply(wire(p))).rejects.toThrow("SYNTHETIC_AUDIT_FAILURE");} finally {audit.mockRestore();}
    expect(await db.client.staffIdentity.count({where:{userId:user.id}})).toBe(0); expect(await db.client.staffTrustEvent.count({where:{userId:user.id}})).toBe(0);
    expect((await db.client.user.findUniqueOrThrow({where:{id:user.id}})).role).toBe("MEMBER");
    expect((await db.client.session.findUniqueOrThrow({where:{id:session.id}})).revokedAt).toBeNull();
  });
  it("retains immutable identity/evidence and rejects delete/recreate/truncate history resets", async () => {
    const {user,p}=await fixture(); await service.apply(wire(p));
    await expect(db.client.staffTrustEvent.update({where:{directiveId:p.directiveId},data:{signedDirective:"{}"}})).rejects.toThrow();
    await expect(db.client.staffTrustEvent.delete({where:{directiveId:p.directiveId}})).rejects.toThrow();
    await expect(db.client.staffIdentity.delete({where:{userId:user.id}})).rejects.toThrow();
    await expect(db.client.$executeRawUnsafe('TRUNCATE "StaffTrustEvent" CASCADE')).rejects.toThrow();
    await expect(db.client.$executeRawUnsafe('TRUNCATE "StaffIdentity" CASCADE')).rejects.toThrow();
    await expect(db.client.user.delete({where:{id:user.id}})).rejects.toThrow();
    expect(await service.current(db.client,user.id,new Date())).toMatchObject({revision:1n});
  });
});
