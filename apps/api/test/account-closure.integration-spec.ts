import { ConsentService } from "../src/consent/consent.service";
import { AssignmentCancellationWorker } from "../src/assignment-cancellation/assignment-cancellation.worker";
import { VideoCleanupService } from "../src/video/video-cleanup.service";
import { randomBytes, randomUUID } from "node:crypto";
import { AccountClosureService } from "../src/account-closure/account-closure.service";
import { ClosureStatusService } from "../src/account-closure/closure-status.service";
import { EmailService } from "../src/auth/email.service";
import { EnvironmentService } from "../src/config/environment.service";
import { digest } from "../src/account-closure/closure.validation";
import { integratedWorkflowHarness, IntegratedWorkflowHarness, orderedTransactions } from "./integrated-workflow-fixtures";

describe("C065 real account restriction and out-of-band status", () => {
  let h: IntegratedWorkflowHarness;
  const input = (password: string) => ({ password, confirmation: "CLOSE MY ACCOUNT", expectedRevision: 0 });
  const close = (actor: {cookie:string;password:string}, key = randomUUID()) =>
    h.request(actor.cookie, "account-closure", input(actor.password), "POST", { "Idempotency-Key": key });
  beforeAll(async () => { h = await integratedWorkflowHarness(); }, 60000);
  afterAll(async () => { await h?.close(); });
  async function statusMail(email: string) {
    for (const end = Date.now() + 15000; Date.now() < end;) {
      const search = await fetch("http://127.0.0.1:8025/api/v1/search?query=" + encodeURIComponent("to:" + email));
      const body = await search.json() as {messages?:{ID:string}[]};
      if (body.messages?.length) {
        const message = await (await fetch("http://127.0.0.1:8025/api/v1/message/" + body.messages[0].ID)).json() as {Text:string};
        const token = /#token=([A-Za-z0-9_-]{43})/.exec(message.Text)?.[1];
        if (token) return token;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    throw Error("Synthetic status email not received");
  }
  test("accepted closure atomically restricts all sessions, tokens and actual consent purposes", async () => {
    const f = await h.workflow("draft");
    expect(await (await h.request(f.owner.cookie,"account-closure/availability",undefined,"GET")).json()).toEqual({available:true});
    const other = await h.login(f.owner.email, f.owner.password);
    await h.db.client.passwordResetToken.create({ data: {userId:f.owner.id,tokenHash:digest(randomUUID()),expiresAt:new Date(Date.now()+60000)} });
    await h.db.client.emailVerificationToken.create({ data: {userId:f.owner.id,tokenHash:digest(randomUUID()),expiresAt:new Date(Date.now()+60000)} });
    expect((await h.request(f.moderator.cookie,"expert-admin/assignments",undefined,"GET")).status).toBe(200);
    const accepted = await close(f.owner);
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({receiptId:expect.any(String),state:"RESTRICTED",revision:1,cleanupPending:true});
    expect(accepted.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
    expect((await h.db.client.user.findUniqueOrThrow({where:{id:f.owner.id}})).status).toBe("CLOSED");
    expect(await h.db.client.session.count({where:{userId:f.owner.id,revokedAt:null}})).toBe(0);
    expect(await h.db.client.passwordResetToken.count({where:{userId:f.owner.id,consumedAt:null}})).toBe(0);
    expect(await h.db.client.emailVerificationToken.count({where:{userId:f.owner.id,consumedAt:null}})).toBe(0);
    expect(await h.db.client.consent.count({where:{userId:f.owner.id,granted:false}})).toBe(5);
    const ledger=await h.db.client.consentLedger.findUniqueOrThrow({where:{userId:f.owner.id}});
    expect(await h.db.client.consentWithdrawalTask.count({where:{subjectId:ledger.subjectId,version:4n,status:"PENDING"}})).toBe(5);
    expect((await h.request(other.cookie,"auth/me",undefined,"GET")).status).toBe(401);
    expect((await h.play(f.expert.cookie,f.id)).status).toBe(403);
    const queue=await h.request(f.moderator.cookie,"expert-admin/assignments",undefined,"GET");
    expect(queue.status).toBe(200);expect((await queue.json() as {assignments:unknown[]}).assignments).toEqual([]);
    expect((await h.request(f.expert.cookie,"expert/reviews/"+f.reviewId+"/draft",{expectedVersion:2,summary:"must not save"},"PATCH")).status).toBe(403);
    const closure=await h.db.client.accountClosure.findUniqueOrThrow({where:{userId:f.owner.id},include:{events:true,consumers:true}});
    expect(closure.events).toHaveLength(1); expect(closure.consumers).toHaveLength(5);
    expect(closure.consumers.every(c=>c.status==="PENDING")).toBe(true);
    await h.app.get(AssignmentCancellationWorker).runOnce();
    await h.app.get(VideoCleanupService).runOnce();
    expect((await h.db.client.expertAssignment.findUniqueOrThrow({where:{id:f.id}})).status).toBe("CANCELLED");
    expect(await h.db.client.assignmentEvent.count({where:{assignmentId:f.id,toStatus:"CANCELLED"}})).toBe(1);
    expect(await h.finalObjectAbsent(f.videoId)).toBe(true);
    expect((await h.db.client.video.findUniqueOrThrow({where:{id:f.videoId}})).cleanupCompletedAt).toBeNull();
    const token=await statusMail(f.owner.email);
    const stored=await h.db.client.closureStatusToken.findUniqueOrThrow({where:{tokenHash:digest(token)}});
    expect(stored.expiresAt.getTime()-stored.createdAt.getTime()).toBeLessThanOrEqual(900100);
    const result=await h.request("","account-closure/status",{token});
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({state:"RESTRICTED",revision:1,cleanupPending:true,retentionPending:true});
    expect((await h.request("","account-closure/status",{token})).status).toBe(400);
    expect((await h.request("","auth/me",undefined,"GET")).status).toBe(401);
    const evidence=JSON.stringify(await h.db.client.auditLog.findMany({where:{subjectId:closure.id}}));
    for(const value of [f.owner.id,f.owner.email,f.owner.password,token,stored.tokenHash]) expect(evidence).not.toContain(value);
  });
  test.each(["EXPERT","MODERATOR","ADMIN"] as const)("%s cannot close through member self-service",async role=>{
    const actor=await h.account(role); expect((await close(actor)).status).toBe(403);
    expect(await h.db.client.accountClosure.count({where:{userId:actor.id}})).toBe(0);
  });
  test.each([
    {password:"wrong",confirmation:"CLOSE MY ACCOUNT",expectedRevision:0},
    {password:"synthetic-security-regression-password",confirmation:"close",expectedRevision:0},
    {password:"synthetic-security-regression-password",confirmation:"CLOSE MY ACCOUNT",expectedRevision:0,userId:"foreign"},
    {password:"synthetic-security-regression-password",confirmation:"CLOSE MY ACCOUNT",expectedRevision:1},
  ])("invalid confirmation, authority or fresh proof is rejected",async body=>{
    const actor=await h.account(); expect((await h.request(actor.cookie,"account-closure",body)).status).toBe(400);
    expect((await h.db.client.user.findUniqueOrThrow({where:{id:actor.id}})).status).toBe("ACTIVE");
  });
  test("missing session, cross-origin request and invalid key fail closed",async()=>{
    const actor=await h.account();
    expect((await h.request("","account-closure",input(actor.password))).status).toBe(401);
    expect((await h.request(actor.cookie,"account-closure",input(actor.password),"POST",{Origin:"https://foreign.invalid"})).status).toBe(403);
    expect((await h.request(actor.cookie,"account-closure",input(actor.password),"POST",{"Idempotency-Key":"invalid"})).status).toBe(400);
  });
  test("audit failure rolls back barrier, credentials, consent and receipts",async()=>{
    const actor=await h.account();
    await h.db.client.$executeRawUnsafe(`CREATE FUNCTION fail_closure_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ACCOUNT_CLOSURE_RESTRICTED' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`);
    await h.db.client.$executeRawUnsafe(`CREATE TRIGGER fail_closure_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_closure_audit()`);
    try { expect((await close(actor)).status).toBe(503); }
    finally { await h.db.client.$executeRawUnsafe(`DROP TRIGGER fail_closure_audit ON "AuditLog"`); await h.db.client.$executeRawUnsafe(`DROP FUNCTION fail_closure_audit()`); }
    expect((await h.db.client.user.findUniqueOrThrow({where:{id:actor.id}})).status).toBe("ACTIVE");
    expect(await h.db.client.accountClosure.count({where:{userId:actor.id}})).toBe(0);
    expect(await h.db.client.consentLedger.count({where:{userId:actor.id}})).toBe(0);
    expect((await h.request(actor.cookie,"auth/me",undefined,"GET")).status).toBe(200);
  });
  test("concurrent same-key pre-authorized requests produce one durable receipt",async()=>{
    const actor=await h.account(),key=randomUUID(); const auth=await h.context(actor);
    const service=h.app.get(AccountClosureService);
    const responses=await orderedTransactions(h,()=>service.request(auth,input(actor.password),key),()=>service.request(auth,input(actor.password),key));
    expect(responses[0]).toEqual(responses[1]);
    const closure=await h.db.client.accountClosure.findUniqueOrThrow({where:{userId:actor.id}});
    expect(await h.db.client.accountClosureEvent.count({where:{closureId:closure.id}})).toBe(1);
    expect(await h.db.client.auditLog.count({where:{subjectId:closure.id,action:"ACCOUNT_CLOSURE_RESTRICTED"}})).toBe(1);
    expect((await close(actor,key)).status).toBe(401);
  });
  test("database prevents reopening, removing ledger and rewriting acceptance evidence",async()=>{
    const actor=await h.account(); expect((await close(actor)).status).toBe(202);
    const closure=await h.db.client.accountClosure.findUniqueOrThrow({where:{userId:actor.id}});
    await expect(h.db.client.user.update({where:{id:actor.id},data:{status:"ACTIVE"}})).rejects.toBeDefined();
    await expect(h.db.client.user.update({where:{id:actor.id},data:{email:randomUUID()+"@foreign.example.invalid"}})).rejects.toBeDefined();
    await expect(h.db.client.accountClosure.delete({where:{id:closure.id}})).rejects.toBeDefined();
    await expect(h.db.client.accountClosureEvent.deleteMany({where:{closureId:closure.id}})).rejects.toBeDefined();
    await expect(h.db.client.user.delete({where:{id:actor.id}})).rejects.toBeDefined();
    await expect(h.db.client.accountClosure.update({where:{id:closure.id},data:{state:"RETENTION_PENDING",revision:2}})).rejects.toBeDefined();
  });
  test("SMTP acceptance followed by transport error does not invalidate the mailed status token",async()=>{
    const actor=await h.account(),email=h.app.get(EmailService),send=email.sendClosureStatus.bind(email);
    const spy=jest.spyOn(email,"sendClosureStatus").mockImplementationOnce(async(address,link)=>{await send(address,link);throw Error("synthetic ambiguous acceptance");});
    try {
      expect((await close(actor)).status).toBe(202);
      const token=await statusMail(actor.email);
      expect((await h.request("","account-closure/status",{token})).status).toBe(200);
    } finally {spy.mockRestore();}
  });
  test("expired and altered tokens are generic; valid concurrent use succeeds once",async()=>{
    const actor=await h.account(); expect((await close(actor)).status).toBe(202);
    const real=await statusMail(actor.email);
    const closure=await h.db.client.accountClosure.findUniqueOrThrow({where:{userId:actor.id}});
    const expired=randomBytes(32).toString("base64url");
    await h.db.client.closureStatusToken.create({data:{closureId:closure.id,tokenHash:digest(expired),expiresAt:new Date(0)}});
    const bad=await h.app.get(ClosureStatusService).consume({token:expired}).catch(e=>e.getResponse());
    const unknown=await h.app.get(ClosureStatusService).consume({token:randomBytes(32).toString("base64url")}).catch(e=>e.getResponse());
    expect(bad).toEqual(unknown);
    const results=await Promise.all([h.request("","account-closure/status",{token:real}),h.request("","account-closure/status",{token:real})]);
    expect(results.map(r=>r.status).sort()).toEqual([200,400]);
  });
  test("public status-email responses disclose no existence or status",async()=>{
    const actor=await h.account();
    const a=await h.request("","account-closure/status-email",{email:actor.email});
    const b=await h.request("","account-closure/status-email",{email:randomUUID()+"@example.invalid"});
    expect(a.status).toBe(202);expect(await a.json()).toEqual(await b.json());
  });

  test("historical C032-only approval duty cannot be bypassed by changing the current role",async()=>{
    const f=await h.workflow("assigned"),moderator=await h.account("MODERATOR");
    const credential=await h.db.client.expertCredential.findUniqueOrThrow({where:{userId:f.expert.id},include:{approval:true}});
    const training=JSON.parse((credential.approval!.trainingEvidence as {content:string}).content) as {sourceId:string};
    const confidentiality=JSON.parse((credential.approval!.confidentialityEvidence as {content:string}).content) as {sourceId:string};
    expect((await h.request(moderator.cookie,"expert-admin/experts/"+f.expert.id+"/approvals",{expectedRevision:Number(credential.revision),trainingVersion:credential.approval!.trainingVersion,policyVersion:credential.approval!.policyVersion,trainingEvidenceId:training.sourceId,confidentialityEvidenceId:confidentiality.sourceId,expiresAt:null})).status).toBe(201);
    await h.db.client.user.update({where:{id:moderator.id},data:{role:"MEMBER"}});
    const session=await h.login(moderator.email,moderator.password);
    const response=await close({...moderator,...session});
    expect(response.status).toBe(409);expect((await response.json() as {code:string}).code).toBe("STAFF_DEPROVISIONING_REQUIRED");
  });
  test("a session expiring during real consent work rolls the entire closure back",async()=>{
    const actor=await h.account(),expiresAt=new Date(Date.now()+600);
    await h.db.client.session.update({where:{id:actor.sessionId},data:{expiresAt}});
    const consents=h.app.get(ConsentService),original=consents.withdrawForClosure.bind(consents);
    const spy=jest.spyOn(consents,"withdrawForClosure").mockImplementationOnce(async(...args)=>{const result=await original(...args);await new Promise(r=>setTimeout(r,Math.max(0,expiresAt.getTime()-Date.now()+30)));return result;});
    try {expect((await close(actor)).status).toBe(403);}finally{spy.mockRestore();}
    expect(await h.db.client.accountClosure.count({where:{userId:actor.id}})).toBe(0);
    expect(await h.db.client.consentLedger.count({where:{userId:actor.id}})).toBe(0);
    expect((await h.db.client.user.findUniqueOrThrow({where:{id:actor.id}})).status).toBe("ACTIVE");
  });
  test("real token quota returns 429 with private headers and Retry-After",async()=>{
    const actor=await h.account(),token=randomBytes(32).toString("base64url");
    for(let i=0;i<5;i++)expect((await h.request(actor.cookie,"account-closure/status",{token})).status).toBe(400);
    const limited=await h.request(actor.cookie,"account-closure/status",{token});
    expect(limited.status).toBe(429);expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("cache-control")).toContain("no-store");expect(limited.headers.get("referrer-policy")).toBe("no-referrer");
  });
  test("a naked CLOSED update without a durable ledger and handoffs is rejected",async()=>{
    const actor=await h.account();
    await expect(h.db.client.user.update({where:{id:actor.id},data:{status:"CLOSED"}})).rejects.toBeDefined();
    expect((await h.db.client.user.findUniqueOrThrow({where:{id:actor.id}})).status).toBe("ACTIVE");
  });

  test("the actual upgraded catalog retains all expected constraints and triggers",async()=>{
    const rows=await h.db.client.$queryRaw<{foreignKeys:number;triggers:number;migrations:number}[]>`SELECT
    (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname=current_schema()) AS "foreignKeys",
    (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname=current_schema()) AS triggers,
    (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL) AS migrations`;
    console.info(JSON.stringify({code:"C065_DISPOSABLE_CATALOG",...rows[0]}));
    // Keep the exact catalog gate while accounting for reviewed additive staff migrations.
    const applied=await h.db.client.$queryRaw<{name:string}[]>`SELECT migration_name AS name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    const staffAdditions=[
      {name:"20261124010000_staff_trust",foreignKeys:2,triggers:6},
      {name:"20261124020000_staff_mfa",foreignKeys:8,triggers:9},
    ].filter(m=>applied.some(row=>row.name===m.name));
    const expected=staffAdditions.reduce((catalog,m)=>({foreignKeys:catalog.foreignKeys+m.foreignKeys,triggers:catalog.triggers+m.triggers,migrations:catalog.migrations+1}),{foreignKeys:54,triggers:76,migrations:24});
    expect(rows[0]).toEqual(expected);
  });
  test("ordinary production release remains fail-closed without a feature-flag override",async()=>{
    const env=h.app.get(EnvironmentService),original=env.values.nodeEnv;
    try {
      Object.defineProperty(env.values,"nodeEnv",{value:"production",configurable:true});
      expect(h.app.get(AccountClosureService).availability()).toEqual({available:false});
      expect(()=>h.app.get(AccountClosureService).available()).toThrow("Account closure is awaiting release review.");
    } finally {Object.defineProperty(env.values,"nodeEnv",{value:original,configurable:true});}
  });
});
