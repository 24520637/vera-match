import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AccountStatus, UserRole } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { hashSessionToken } from "../src/auth/session-token";
import { configureApplication } from "../src/configure-app";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { PrismaService } from "../src/database/prisma.service";
import { ExpertApprovalRateLimiter } from "../src/expert-admin/expert-approval-request.guard";
import { ExpertApprovalRegistry, ExpertEvidence, ExpertEvidenceSource } from "../src/expert-admin/expert-approval.sources";
import { createAuthDatabase } from "./disposable-auth-database";
import { assign, credentialEvent, seedExpert, transition } from "./expert-db-fixtures";

const trainingVersion = "synthetic-training-v1", policyVersion = "synthetic-confidentiality-v1";
describe("C032 moderator expert approval / disposable PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>, app: INestApplication, base: string;
  let records: Map<string, ExpertEvidence>;
  const origin = "http://localhost:3000";
  beforeAll(async () => { db = await createAuthDatabase(); }, 60000);
  beforeEach(async () => {
    if (process.env.NODE_ENV !== "test" || !/^vera_auth_test_[a-f0-9]{32}$/.test(db.schema)) throw new Error("Synthetic fixture requires disposable schema");
    records = new Map();
    const values = parseEnvironment({ ...process.env, NODE_ENV: "test", DATABASE_URL: db.url, CORS_ORIGIN: origin,
      MINIO_ROOT_USER: "synthetic-test", MINIO_ROOT_PASSWORD: "synthetic-test-only" });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EnvironmentService).useValue({ values })
      .overrideProvider(PrismaService).useValue(db.client)
      .overrideProvider(ExpertApprovalRegistry).useValue({
        training: (version: string) => version === trainingVersion ? { version, content: "SYNTHETIC TRAINING CONTENT ONLY" } : undefined,
        confidentiality: (version: string) => version === policyVersion ? { version, content: "SYNTHETIC CONFIDENTIALITY POLICY ONLY" } : undefined,
      })
      .overrideProvider(ExpertEvidenceSource).useValue({ find: async (id: string) => records.get(id) }).compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterEach(async () => { await app?.close(); });
  afterAll(async () => { await db?.close(); });
  async function user(role: UserRole = UserRole.MODERATOR, status: AccountStatus = AccountStatus.ACTIVE, verified = true) {
    const token = randomBytes(32).toString("base64url");
    const row = await db.client.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-only",
      role, status, emailVerifiedAt: verified ? new Date() : null,
      sessions: { create: { tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 600000) } } } });
    return { ...row, cookie: `${app.get(EnvironmentService).values.session.cookieName}=${token}` };
  }
  function input(userId: string, expectedRevision = 0, expiresAt: string | null = null) {
    const trainingEvidenceId = randomUUID(), confidentialityEvidenceId = randomUUID();
    for (const [id, kind, version, content] of [
      [trainingEvidenceId, "TRAINING_COMPLETION", trainingVersion, "SYNTHETIC: completed all training exercises"],
      [confidentialityEvidenceId, "CONFIDENTIALITY_ACCEPTANCE", policyVersion, "SYNTHETIC: explicitly accepted confidentiality obligations"],
    ] as const) records.set(id, { id, userId, kind, version, content, recordedAt: new Date("2026-01-01"), validUntil: null });
    return { expectedRevision, trainingVersion, policyVersion, trainingEvidenceId, confidentialityEvidenceId, expiresAt };
  }
  const request = (cookie: string, id: string, body: unknown, headers: Record<string, string> = {}, query = "") =>
    fetch(`${base}/api/expert-admin/experts/${id}/approvals${query}`, { method: "POST", headers: {
      Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers,
    }, body: JSON.stringify(body) });
  const credential = (id: string) => db.client.expertCredential.findUnique({ where: { userId: id } });

  it("requires an authenticated ACTIVE verified MODERATOR, without ADMIN inheritance or member self-approval", async () => {
    const expert = await user(UserRole.EXPERT), body = input(expert.id);
    const missing = await request("", expert.id, body);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("cache-control")).toContain("no-store");
    for (const role of [UserRole.MEMBER, UserRole.EXPERT, UserRole.ADMIN]) {
      const caller = await user(role);
      expect((await request(caller.cookie, caller.id, input(caller.id))).status).toBe(403);
      expect((await request(caller.cookie, expert.id, body)).status).toBe(403);
    }
    for (const status of [AccountStatus.PENDING_EMAIL, AccountStatus.SUSPENDED, AccountStatus.DELETED]) {
      const caller = await user(UserRole.MODERATOR, status);
      expect((await request(caller.cookie, expert.id, body)).status).toBe(401);
    }
    const unverified = await user(UserRole.MODERATOR, AccountStatus.ACTIVE, false);
    expect((await request(unverified.cookie, expert.id, body)).status).toBe(401);
    const revoked = await user();
    await db.client.session.updateMany({ where: { userId: revoked.id }, data: { revokedAt: new Date() } });
    expect((await request(revoked.cookie, expert.id, body)).status).toBe(401);
    const expired = await user();
    await db.client.session.updateMany({ where: { userId: expired.id }, data: { expiresAt: new Date(0) } });
    expect((await request(expired.cookie, expert.id, body)).status).toBe(401);
    expect(await credential(expert.id)).toBeNull();
  });

  it("initializes PENDING revision zero and approves revision one with server-owned immutable evidence", async () => {
    const moderator = await user(), expert = await user(UserRole.EXPERT), body = input(expert.id);
    const before = Date.now();
    const response = await request(moderator.cookie, expert.id, body);
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({ revision: 1, credential: { userId: expert.id, status: "APPROVED", expiresAt: null } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const row = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: expert.id } });
    const approval = await db.client.expertCredentialApproval.findUniqueOrThrow({ where: { id: row.approvalId! } });
    expect(row.revision).toBe(1n);
    expect(approval.verifiedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(approval.approvedAt).toEqual(approval.verifiedAt);
    for (const field of ["trainingEvidence", "confidentialityEvidence"] as const) {
      const snapshot = approval[field] as { content: string; sha256: string };
      expect(snapshot.sha256).toBe(createHash("sha256").update(snapshot.content).digest("hex"));
      expect(JSON.parse(snapshot.content)).toMatchObject({ subject: row.subjectId, content: expect.stringContaining("SYNTHETIC"), approvedContent: expect.any(String) });
    }
    const actor = await db.client.expertActorIdentity.findUniqueOrThrow({ where: { userId: moderator.id } });
    expect(approval.approvedByEvidence).toEqual({ subject: actor.subjectId });
    const events = await db.client.expertCredentialEvent.findMany({ where: { subjectId: row.subjectId }, orderBy: { revision: "asc" } });
    expect(events.map(e => [e.kind, e.revision])).toEqual([["CREATED", 0n], ["APPROVED", 1n]]);
    expect(events[1]).toMatchObject({ approvalId: approval.id, trainingVersion, policyVersion, actorEvidence: { subject: actor.subjectId } });
    expect(JSON.stringify(result)).not.toMatch(/trainingEvidence|confidentialityEvidence|subject|sha256|SYNTHETIC/);
    await expect(db.client.expertCredentialApproval.update({ where: { id: approval.id }, data: { trainingVersion: "forged" } })).rejects.toThrow("append-only");
    await expect(db.client.expertCredentialEvent.delete({ where: { id: events[1].id } })).rejects.toThrow("append-only");
  });

  it("never creates users, changes roles or activates an ineligible target", async () => {
    const moderator = await user();
    const count = await db.client.user.count();
    expect((await request(moderator.cookie, "missing-expert", input("missing-expert"))).status).toBe(404);
    expect(await db.client.user.count()).toBe(count);
    for (const role of [UserRole.MEMBER, UserRole.ADMIN, UserRole.MODERATOR]) {
      const target = await user(role);
      expect((await request(moderator.cookie, target.id, input(target.id))).status).toBe(403);
      expect(await credential(target.id)).toBeNull();
    }
    for (const [status, verified] of [[AccountStatus.SUSPENDED, true], [AccountStatus.PENDING_EMAIL, false], [AccountStatus.DELETED, true], [AccountStatus.ACTIVE, false]] as const) {
      const target = await user(UserRole.EXPERT, status, verified);
      expect((await request(moderator.cookie, target.id, input(target.id))).status).toBe(403);
      expect(await credential(target.id)).toBeNull();
      expect(await db.client.user.findUnique({ where: { id: target.id } })).toMatchObject({ status, role: "EXPERT" });
    }
  });

  it("fails closed for unapproved training or confidentiality versions and missing trusted evidence", async () => {
    const moderator = await user(), expert = await user(UserRole.EXPERT);
    for (const field of ["trainingVersion", "policyVersion"] as const) {
      const response = await request(moderator.cookie, expert.id, { ...input(expert.id), [field]: "unapproved" });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED", details: [{ field }] });
    }
    const body = input(expert.id);
    records.delete(body.trainingEvidenceId);
    const missing = await request(moderator.cookie, expert.id, body);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ code: "EXPERT_APPROVAL_UNAVAILABLE" });
    expect(await credential(expert.id)).toBeNull();
    expect(await db.client.expertActorIdentity.findUnique({ where: { userId: moderator.id } })).toBeNull();
  });

  it("rechecks moderator eligibility, target eligibility and session revocation after authentication", async () => {
    for (const scenario of ["moderator", "target", "session"] as const) {
      const moderator = await user(), expert = await user(UserRole.EXPERT);
      const body = input(expert.id);
      const source = app.get(ExpertEvidenceSource);
      const lookup = jest.spyOn(source, "find").mockImplementation(async id => {
        if (id === body.trainingEvidenceId) {
          if (scenario === "session") await db.client.session.updateMany({ where: { userId: moderator.id }, data: { revokedAt: new Date() } });
          else await db.client.user.update({ where: { id: scenario === "moderator" ? moderator.id : expert.id }, data: { status: "SUSPENDED" } });
        }
        return records.get(id);
      });
      try {
        expect((await request(moderator.cookie, expert.id, body)).status).toBe(scenario === "session" ? 401 : 403);
        expect(await credential(expert.id)).toBeNull();
        expect(await db.client.expertActorIdentity.findUnique({ where: { userId: moderator.id } })).toBeNull();
      } finally { lookup.mockRestore(); }
    }
  });

  it("rejects evidence for another expert, version, purpose, future completion or expired validity", async () => {
    const moderator = await user(), expert = await user(UserRole.EXPERT);
    for (const patch of [{ userId: "another-user" }, { version: "different-version" }, { kind: "CONFIDENTIALITY_ACCEPTANCE" },
      { recordedAt: new Date("2099-01-01") }, { validUntil: new Date("2000-01-01") }, { content: " " }]) {
      const body = input(expert.id);
      Object.assign(records.get(body.trainingEvidenceId)!, patch);
      expect((await request(moderator.cookie, expert.id, body)).status).toBe(400);
    }
    expect(await credential(expert.id)).toBeNull();
  });

  it("accepts explicit null or bounded future expiry without inventing a default", async () => {
    const moderator = await user();
    for (const expiry of [null, "2098-01-01T00:00:00.000Z"]) {
      const expert = await user(UserRole.EXPERT), body = input(expert.id, 0, expiry);
      records.get(body.trainingEvidenceId)!.validUntil = new Date("2099-01-01");
      expect((await request(moderator.cookie, expert.id, body)).status).toBe(201);
      const row = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: expert.id } });
      expect(await db.client.expertCredentialApproval.findUnique({ where: { id: row.approvalId! } })).toMatchObject({ expiresAt: expiry ? new Date(expiry) : null });
    }
  });

  it("rejects past expiry and expiry exceeding either underlying evidence validity", async () => {
    const moderator = await user(), expert = await user(UserRole.EXPERT);
    expect((await request(moderator.cookie, expert.id, input(expert.id, 0, "2000-01-01T00:00:00.000Z"))).status).toBe(400);
    for (const field of ["trainingEvidenceId", "confidentialityEvidenceId"] as const) {
      const body = input(expert.id, 0, "2099-01-01T00:00:00.000Z");
      records.get(body[field])!.validUntil = new Date("2098-01-01");
      expect((await request(moderator.cookie, expert.id, body)).status).toBe(400);
    }
    expect(await credential(expert.id)).toBeNull();
  });

  it("rejects forged authority, snapshot, audit and timestamp fields with structured paths", async () => {
    const moderator = await user(), expert = await user(UserRole.EXPERT);
    for (const field of ["mfaVerified", "role", "approvedById", "verifiedAt", "approvedAt", "sha256", "trainingEvidence", "userId"]) {
      const response = await request(moderator.cookie, expert.id, { ...input(expert.id), [field]: "forged" });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ details: [{ field: "_form" }] });
    }
    expect(await credential(expert.id)).toBeNull();
  });

  it("requires Origin/JSON and rejects query-selected identities without writes", async () => {
    const moderator = await user(), expert = await user(UserRole.EXPERT), body = input(expert.id);
    expect((await request(moderator.cookie, expert.id, body, { Origin: "https://untrusted.invalid" })).status).toBe(403);
    expect((await request(moderator.cookie, expert.id, body, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await request(moderator.cookie, expert.id, body, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await request(moderator.cookie, expert.id, body, {}, "?actorId=forged")).status).toBe(400);
    expect(await credential(expert.id)).toBeNull();
  });

  it("uses separate rate limits and returns Retry-After without recording approval", async () => {
    const moderator = await user(), expert = await user(UserRole.EXPERT);
    const limiter = app.get(ExpertApprovalRateLimiter);
    for (let i = 0; i < 20; i++) limiter.consume("expert-approval:moderator", moderator.id, 20, 60000);
    const response = await request(moderator.cookie, expert.id, input(expert.id));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await credential(expert.id)).toBeNull();
  });

  it("rejects stale first initialization and stale reapproval without creating orphan evidence", async () => {
    const moderator = await user(), expert = await user(UserRole.EXPERT);
    expect((await request(moderator.cookie, expert.id, input(expert.id, 1))).status).toBe(409);
    expect(await credential(expert.id)).toBeNull();
    const body = input(expert.id);
    expect((await request(moderator.cookie, expert.id, body)).status).toBe(201);
    const original = await credential(expert.id);
    const stale = await request(moderator.cookie, expert.id, body);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "RESOURCE_REVISION_CONFLICT" });
    expect(await credential(expert.id)).toEqual(original);
    expect(await db.client.expertCredentialApproval.count({ where: { subjectId: original!.subjectId } })).toBe(1);
  });

  it("serializes concurrent first approvals so exactly one request and audit pair succeed", async () => {
    const first = await user(), second = await user(), expert = await user(UserRole.EXPERT), body = input(expert.id);
    const responses = await Promise.all([request(first.cookie, expert.id, body), request(second.cookie, expert.id, body)]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const row = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: expert.id } });
    expect(row.revision).toBe(1n);
    expect(await db.client.expertCredentialApproval.count({ where: { subjectId: row.subjectId } })).toBe(1);
    expect(await db.client.expertCredentialEvent.count({ where: { subjectId: row.subjectId } })).toBe(2);
    const winner = responses[0].status === 201 ? first : second;
    const winnerActor = await db.client.expertActorIdentity.findUniqueOrThrow({ where: { userId: winner.id } });
    expect(await db.client.expertCredentialApproval.findUnique({ where: { id: row.approvalId! } })).toMatchObject({ approvedByEvidence: { subject: winnerActor.subjectId } });
  });

  it("approves an existing pending credential without duplicating its creation event", async () => {
    const moderator = await user(), expert = await user(UserRole.EXPERT);
    const pending = await db.client.$transaction(async tx => {
      const row = await tx.expertCredential.create({ data: { userId: expert.id } });
      await credentialEvent(tx, row, "CREATED");
      return row;
    });
    expect((await request(moderator.cookie, expert.id, input(expert.id))).status).toBe(201);
    expect(await credential(expert.id)).toMatchObject({ subjectId: pending.subjectId, revision: 1n, status: "APPROVED" });
    expect(await db.client.expertCredentialEvent.count({ where: { subjectId: pending.subjectId, kind: "CREATED" } })).toBe(1);
  });

  it("serializes concurrent reapprovals and retains the winning approval without retry", async () => {
    const first = await user(), second = await user(), expert = await user(UserRole.EXPERT);
    expect((await request(first.cookie, expert.id, input(expert.id))).status).toBe(201);
    const body = input(expert.id, 1);
    const responses = await Promise.all([request(first.cookie, expert.id, body), request(second.cookie, expert.id, body)]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const row = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: expert.id } });
    expect(row.revision).toBe(2n);
    expect(await db.client.expertCredentialApproval.count({ where: { subjectId: row.subjectId } })).toBe(2);
    expect(await db.client.expertCredentialEvent.count({ where: { subjectId: row.subjectId } })).toBe(3);
    expect(await responses.find(response => response.status === 201)!.json()).toMatchObject({ revision: 2, credential: { approvalId: row.approvalId } });
  });

  it("reapproves a revoked credential with a new instance while retaining revocation evidence", async () => {
    const moderator = await user(), seed = await seedExpert(db.client);
    await db.client.user.update({ where: { id: seed.expert.id }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });
    await db.client.$transaction(async tx => {
      const row = await tx.expertCredential.update({ where: { userId: seed.expert.id }, data: { status: "REVOKED", revokedAt: new Date(), revision: 2n } });
      await credentialEvent(tx, row, "REVOKED", "Synthetic review withdrawal");
    });
    expect((await request(moderator.cookie, seed.expert.id, input(seed.expert.id, 2))).status).toBe(201);
    const row = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: seed.expert.id } });
    expect(row).toMatchObject({ status: "APPROVED", revision: 3n, revokedAt: null });
    expect(row.approvalId).not.toBe(seed.approval.id);
    expect(await db.client.expertCredentialEvent.findUnique({ where: { subjectId_revision: { subjectId: row.subjectId, revision: 2n } } })).toMatchObject({ kind: "REVOKED", reason: "Synthetic review withdrawal" });
  });

  it("creates new immutable reapproval instances without reactivating cancelled assignments", async () => {
    const moderator = await user(), seed = await seedExpert(db.client);
    await db.client.user.update({ where: { id: seed.expert.id }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });
    const assignment = await assign(db.client, seed);
    await transition(db.client, assignment.id, 0n, "CANCELLED");
    const response = await request(moderator.cookie, seed.expert.id, input(seed.expert.id, 1));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({ revision: 2, credential: { approvalId: expect.not.stringMatching(`^${seed.approval.id}$`) } });
    expect(await db.client.expertCredentialApproval.findUnique({ where: { id: seed.approval.id } })).toEqual(seed.approval);
    expect(await db.client.expertAssignment.findUnique({ where: { id: assignment.id } })).toMatchObject({ status: "CANCELLED", revision: 1n, credentialApprovalId: seed.approval.id });
    expect((await request(moderator.cookie, seed.expert.id, input(seed.expert.id, 2))).status).toBe(201);
    expect((await credential(seed.expert.id))?.revision).toBe(3n);
  });

  it("rolls back initialization, identity, approval and both audit writes on an injected final-event failure", async () => {
    const moderator = await user(), expert = await user(UserRole.EXPERT), body = input(expert.id);
    const count = await db.client.expertCredentialApproval.count();
    const eventCount = await db.client.expertCredentialEvent.count();
    await db.client.$executeRawUnsafe(`CREATE FUNCTION c032_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.kind='APPROVED' THEN RAISE EXCEPTION 'Synthetic final audit failure'; END IF; RETURN NEW; END $$`);
    await db.client.$executeRawUnsafe('CREATE TRIGGER "c032_test_failure" BEFORE INSERT ON "ExpertCredentialEvent" FOR EACH ROW EXECUTE FUNCTION c032_test_failure()');
    try {
      expect((await request(moderator.cookie, expert.id, body)).status).toBe(503);
      expect(await credential(expert.id)).toBeNull();
      expect(await db.client.expertActorIdentity.findUnique({ where: { userId: moderator.id } })).toBeNull();
      expect(await db.client.expertCredentialApproval.count()).toBe(count);
      expect(await db.client.expertCredentialEvent.count()).toBe(eventCount);
    } finally {
      await db.client.$executeRawUnsafe('DROP TRIGGER "c032_test_failure" ON "ExpertCredentialEvent"');
      await db.client.$executeRawUnsafe('DROP FUNCTION c032_test_failure()');
    }
    expect((await request(moderator.cookie, expert.id, body)).status).toBe(201);
  });
});
