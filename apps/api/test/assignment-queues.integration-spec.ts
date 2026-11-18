import { StaffAssuranceSource } from "../src/safety/staff-assurance.source";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AccountStatus, Prisma, UserRole } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { hashSessionToken } from "../src/auth/session-token";
import { configureApplication } from "../src/configure-app";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { PrismaService } from "../src/database/prisma.service";
import { ConsentService } from "../src/consent/consent.service";
import { ConsentAccessService } from "../src/consent/consent-access.service";
import { ConsentPolicyRegistry } from "../src/consent/consent.policy";
import { ExpertApprovalRegistry, ExpertEvidenceSource, ExpertEvidence } from "../src/expert-admin/expert-approval.sources";
import { createAuthDatabase } from "./disposable-auth-database";
import { credentialEvent, transition } from "./expert-db-fixtures";
import { VideoService } from "../src/video/video.service";

describe("C035 assignment queue APIs / disposable PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>, app: INestApplication, base: string;
  let records: Map<string, ExpertEvidence>, policyVersion: string, testOnly: boolean;
  const origin = "http://localhost:3000", trainingVersion = "synthetic-training-v1", confidentialityVersion = "synthetic-confidentiality-v1";
  beforeAll(async () => { db = await createAuthDatabase(); }, 60000);
  beforeEach(async () => {
    if (process.env.NODE_ENV !== "test" || !/^vera_auth_test_[a-f0-9]{32}$/.test(db.schema)) throw new Error("Disposable test schema required");
    records = new Map(); policyVersion = `synthetic-${randomUUID()}`; testOnly = true;
    const values = parseEnvironment({ ...process.env, NODE_ENV: "test", DATABASE_URL: db.url, CORS_ORIGIN: origin,
      MINIO_ROOT_USER: "synthetic-test", MINIO_ROOT_PASSWORD: "synthetic-test-only" });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EnvironmentService).useValue({ values })
      .overrideProvider(PrismaService).useValue(db.client)
      .overrideProvider(StaffAssuranceSource).useValue({ resolve: async (_tx: unknown, auth: { sessionId: string; user: { id: string } }) => ({ userId: auth.user.id, sessionId: auth.sessionId, level: "MFA", verifiedAt: new Date("2026-01-01"), expiresAt: new Date(Date.now() + 600000), testOnly: true }) })
      .overrideProvider(ConsentPolicyRegistry).useValue({ current: (purpose: string) => ({ purpose, policyVersion, locale: "en",
        content: `SYNTHETIC ${purpose} POLICY`, testOnly }) })
      .overrideProvider(ExpertApprovalRegistry).useValue({ training: (version: string) => version === trainingVersion ? { version, content: "SYNTHETIC TRAINING" } : undefined,
        confidentiality: (version: string) => version === confidentialityVersion ? { version, content: "SYNTHETIC CONFIDENTIALITY" } : undefined })
      .overrideProvider(ExpertEvidenceSource).useValue({ find: async (id: string) => records.get(id) }).compile();
    app = module.createNestApplication({ logger: false }); configureApplication(app); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
  });
  afterEach(async () => { await app?.close(); });
  afterAll(async () => { await db?.close(); });
  async function user(role: UserRole, status: AccountStatus = AccountStatus.ACTIVE, verified = true) {
    const token = randomBytes(32).toString("base64url");
    const row = await db.client.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-only", role, status,
      emailVerifiedAt: verified ? new Date() : null,
      sessions: { create: { tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 600000) } } } });
    return { ...row, cookie: `${app.get(EnvironmentService).values.session.cookieName}=${token}` };
  }
  const request = (cookie: string, body: unknown, key: string = randomUUID(), headers: Record<string, string> = {}, path = "assignments") =>
    fetch(`${base}/api/expert-admin/${path}`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json",
      "Idempotency-Key": key, ...headers }, body: JSON.stringify(body) });
  async function patchConsent(id: string, version: number, purpose: "VIDEO_STORAGE" | "EXPERT_VIDEO_REVIEW", granted: boolean) {
    return app.get(ConsentService).patch(id, { expectedVersion: version, consents: [{ purpose, granted, ...(granted ? { policyVersion } : {}) }] }, randomUUID());
  }
  async function fixture(expiry: string | null = null, evidenceExpiry: Date | null = null) {
    const moderator = await user("MODERATOR"), owner = await user("MEMBER"), expert = await user("EXPERT");
    const trainingEvidenceId = randomUUID(), confidentialityEvidenceId = randomUUID();
    for (const [id, kind, version] of [[trainingEvidenceId, "TRAINING_COMPLETION", trainingVersion],
      [confidentialityEvidenceId, "CONFIDENTIALITY_ACCEPTANCE", confidentialityVersion]] as const)
      records.set(id, { id, kind, version, userId: expert.id, content: `SYNTHETIC ${kind} RECORD`, recordedAt: new Date("2026-01-01"), validUntil: evidenceExpiry });
    const approved = await request(moderator.cookie, { expectedRevision: 0, trainingVersion, policyVersion: confidentialityVersion,
      trainingEvidenceId, confidentialityEvidenceId, expiresAt: expiry }, randomUUID(), {}, `experts/${expert.id}/approvals`);
    expect(approved.status).toBe(201);
    await app.get(ConsentService).patch(owner.id, { expectedVersion: 0, consents: [
      { purpose: "VIDEO_STORAGE", granted: true, policyVersion }, { purpose: "EXPERT_VIDEO_REVIEW", granted: true, policyVersion },
    ] }, randomUUID());
    const video = await db.client.video.create({ data: { ownerId: owner.id, bucket: "synthetic-private", objectKey: randomUUID(),
      mimeType: "video/mp4", status: "READY", storageConsentVersion: 1n } });
    const body = { videoId: video.id, expertId: expert.id, expectedCredentialRevision: 1, dueAt: null, expiresAt: null };
    return { moderator, owner, expert, video, body, trainingEvidenceId, confidentialityEvidenceId };
  }
  async function create(seed: Awaited<ReturnType<typeof fixture>>, key = randomUUID()) {
    const response = await request(seed.moderator.cookie, seed.body, key);
    expect(response.status).toBe(201);
    return await response.json() as { assignment: { id: string; status: string; revision: number } };
  }
  const get = (cookie: string, path: string) => fetch(`${base}/api/${path}`, { headers: { Cookie: cookie, Origin: origin } });
  const candidatePath = (seed: Awaited<ReturnType<typeof fixture>>) => `expert-admin/assignments/candidate?videoId=${seed.video.id}&expertId=${seed.expert.id}`;
  test("expert queue contains only own safe metadata", async () => {
    const seed = await fixture(), other = await fixture(), own = await create(seed); await create(other);
    const response = await get(seed.expert.cookie, "expert/assignments/me");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ assignments: [{ id: own.assignment.id, status: "ASSIGNED", dueAt: null }], nextCursor: null });
  });
  test.each(["MEMBER", "ADMIN", "MODERATOR"] as const)("%s cannot list expert assignments", async role => {
    expect((await get((await user(role)).cookie, "expert/assignments/me")).status).toBe(403);
  });
  test.each(["MEMBER", "ADMIN", "EXPERT"] as const)("%s cannot check moderator candidates", async role => {
    expect((await get((await user(role)).cookie, "expert-admin/assignments/candidate?videoId=v&expertId=e")).status).toBe(403);
  });
  test("missing session is 401 and default assurance is fail-closed", async () => {
    expect((await get("", "expert/assignments/me")).status).toBe(401);
    const expert = await user("EXPERT"); jest.spyOn(app.get(StaffAssuranceSource), "resolve").mockResolvedValue(undefined);
    expect((await get(expert.cookie, "expert/assignments/me")).status).toBe(403);
  });
  test("expired assurance cannot reveal own metadata", async () => {
    const seed = await fixture(); await create(seed);
    jest.spyOn(app.get(StaffAssuranceSource), "resolve").mockResolvedValue({ userId: seed.expert.id,
      sessionId: (await db.client.session.findFirstOrThrow({ where: { userId: seed.expert.id } })).id,
      level: "MFA", verifiedAt: new Date(0), expiresAt: new Date(1), testOnly: true });
    expect((await get(seed.expert.cookie, "expert/assignments/me")).status).toBe(403);
  });
  test("candidate evidence/source outage fails closed without exposing details", async () => {
    const seed = await fixture();
    jest.spyOn(app.get(ExpertEvidenceSource), "find").mockResolvedValue(undefined);
    const response = await get(seed.moderator.cookie, candidatePath(seed));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(seed.trainingEvidenceId);
  });
  test("missing scope membership exposes neither own creations nor another moderator's assignments", async () => {
    const own = await fixture(), other = await fixture();
    const first = await create(own), second = await create(other);
    expect(await db.client.expertAssignment.count({ where: { id: { in: [first.assignment.id, second.assignment.id] } } })).toBe(2);
      const response = await get(own.moderator.cookie, "expert-admin/assignments?status=ASSIGNED");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json() as Record<string, unknown>;
      expect(body).toEqual({ assignments: [], nextCursor: null });
      expect(JSON.stringify(body)).not.toContain(first.assignment.id);
      expect(JSON.stringify(body)).not.toContain(second.assignment.id);
      expect(await db.client.assignmentModeratorScope.count()).toBe(0);
      expect(await db.client.auditLog.count({ where: { actorId: own.moderator.id, action: "ASSIGNMENT_QUEUE_READ" } })).toBe(1);
  });
  test.each(["MEMBER", "ADMIN", "EXPERT"] as const)("%s cannot list moderator assignments", async role => {
    expect((await get((await user(role)).cookie, "expert-admin/assignments")).status).toBe(403);
  });
  test.each(["scopeId=forged", "moderatorId=another", "assignedById=another"])("client-supplied scope %s is rejected", async query => {
    const moderator = await user("MODERATOR");
    expect((await get(moderator.cookie, "expert-admin/assignments?" + query)).status).toBe(400);
  });
  test("moderator list preserves missing-session and rate-limit behavior before scope reads", async () => {
    expect((await get("", "expert-admin/assignments")).status).toBe(401);
    const moderator = await user("MODERATOR");
    const { AssignmentQueuesLimiter } = await import("../src/expert-admin/assignment-queues-request.guard");
    const limiter = app.get(AssignmentQueuesLimiter);
    for (let index = 0; index < 60; index++) limiter.consume("assignment-queues:actor", moderator.id, 60, 60000);
    const response = await get(moderator.cookie, "expert-admin/assignments");
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  test.each(["?userId=another", "?status=UNKNOWN", "?cursor=!!!!", "?status=ASSIGNED&status=CANCELLED"])("strict queue query rejects %s", async query => {
    expect((await get((await user("EXPERT")).cookie, "expert/assignments/me" + query)).status).toBe(400);
  });
  test("eligible candidate pair supplies the current revision and no private fields", async () => {
    const seed = await fixture(), response = await get(seed.moderator.cookie, candidatePath(seed));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ candidate: { videoId: seed.video.id, expertId: seed.expert.id, expectedCredentialRevision: 1 } });
    expect(await db.client.expertAssignment.count({ where: { videoId: seed.video.id } })).toBe(0);
  });
  test("candidate becomes unavailable after assignment creation, including SUBMITTED", async () => {
    const seed = await fixture(), result = await create(seed);
    expect((await get(seed.moderator.cookie, candidatePath(seed))).status).toBe(404);
    await transition(db.client, result.assignment.id, 0n, "IN_PROGRESS");
    await transition(db.client, result.assignment.id, 1n, "SUBMITTED");
    expect((await get(seed.moderator.cookie, candidatePath(seed))).status).toBe(404);
    const rows = await (await get(seed.expert.cookie, "expert/assignments/me?status=SUBMITTED")).json() as { assignments: { id: string }[] };
    expect(rows.assignments).toHaveLength(1);
  });
  test.each(["deleted", "not-ready", "storage-off", "review-off", "blocked", "unverified-expert", "suspended-owner"])("ineligible %s candidate is not exposed", async reason => {
    const seed = await fixture();
    if (reason === "deleted") await db.client.video.update({ where: { id: seed.video.id }, data: { deletedAt: new Date() } });
    if (reason === "not-ready") await db.client.video.update({ where: { id: seed.video.id }, data: { status: "UPLOADING" } });
    if (reason === "storage-off" || reason === "review-off") await patchConsent(seed.owner.id, 1, reason === "storage-off" ? "VIDEO_STORAGE" : "EXPERT_VIDEO_REVIEW", false);
    if (reason === "blocked") await db.client.block.create({ data: { blockerId: seed.owner.id, blockedId: seed.expert.id } });
    if (reason === "unverified-expert") await db.client.user.update({ where: { id: seed.expert.id }, data: { emailVerifiedAt: null } });
    if (reason === "suspended-owner") await db.client.user.update({ where: { id: seed.owner.id }, data: { status: "SUSPENDED" } });
    expect((await get(seed.moderator.cookie, candidatePath(seed))).status).toBe(404);
  });
  test("storage withdrawal followed by regrant does not revive a stale video", async () => {
    const seed = await fixture(); await patchConsent(seed.owner.id, 1, "VIDEO_STORAGE", false); await patchConsent(seed.owner.id, 2, "VIDEO_STORAGE", true);
    expect((await get(seed.moderator.cookie, candidatePath(seed))).status).toBe(404);
  });
  test("queue pagination is stable, scoped and duplicate-free", async () => {
    const seed = await fixture();
    const approval = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: seed.expert.id } });
    const { assignmentEvent } = await import("./expert-db-fixtures");
    for (let index = 0; index < 51; index++) await db.client.$transaction(async tx => {
      const video = await tx.video.create({ data: { ownerId: seed.owner.id, bucket: "synthetic-private", objectKey: randomUUID(), mimeType: "video/mp4" } });
      const row = await tx.expertAssignment.create({ data: { videoId: video.id, expertId: seed.expert.id, credentialApprovalId: approval.approvalId, assignedById: seed.moderator.id, assignedByEvidence: { subject: "synthetic" } } });
      await assignmentEvent(tx, row.id, null);
    });
    const first = await (await get(seed.expert.cookie, "expert/assignments/me")).json() as { assignments: { id: string }[]; nextCursor: string | null };
    expect(first.assignments).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
    const second = await (await get(seed.expert.cookie, "expert/assignments/me?cursor=" + first.nextCursor)).json() as { assignments: { id: string }[]; nextCursor: string | null };
    expect(second.assignments).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.assignments, ...second.assignments].map((row: { id: string }) => row.id)).size).toBe(51);
  });
});
