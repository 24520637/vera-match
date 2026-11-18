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

describe("C033 assignment API / disposable PostgreSQL", () => {
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
  function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
  }
  async function futureClock(milliseconds = 3000) {
    const [clock] = await db.client.$queryRaw<{ at: Date }[]>`SELECT
      (clock_timestamp() AT TIME ZONE 'UTC' + ${milliseconds} * interval '1 millisecond')::timestamp(3) AS at`;
    return clock.at;
  }
  async function passDeadline(deadline: Date, client: Pick<Prisma.TransactionClient, "$queryRaw"> = db.client) {
    // Database time, not JS fake timers or transaction_timestamp. No service is stopped.
    await client.$queryRaw`SELECT true AS elapsed FROM pg_sleep(GREATEST(0,
      EXTRACT(EPOCH FROM ((${deadline}::timestamptz AT TIME ZONE 'UTC') - (clock_timestamp() AT TIME ZONE 'UTC'))))::double precision + 0.05)`;
  }
  async function waitForUserContention(blockerPid?: number) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const rows = await db.client.$queryRaw<{ pid: number; blockers: number[] }[]>`SELECT a.pid,
        pg_blocking_pids(a.pid) AS blockers FROM pg_stat_activity a
        WHERE a.datname=current_database() AND a.wait_event_type='Lock'
          AND cardinality(pg_blocking_pids(a.pid)) > 0
          AND position('FROM "User"' IN a.query) > 0
          AND position('FOR UPDATE' IN a.query) > 0
          AND (${blockerPid ?? null}::integer IS NULL OR ${blockerPid ?? null}::integer = ANY(pg_blocking_pids(a.pid)))
          AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='"User"'::regclass AND l.mode='RowShareLock')`;
      if (rows.length) return rows;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Expected PostgreSQL User-lock contention was not observed");
  }
  async function expectNoAssignmentSuccess(videoId: string) {
    expect(await db.client.expertAssignment.count({ where: { videoId } })).toBe(0);
    // Event snapshot and receipt response both contain the video locator.
    expect(await db.client.assignmentEvent.count({ where: { snapshot: { path: ["videoId"], equals: videoId } } })).toBe(0);
    expect(await db.client.assignmentIdempotency.count({ where: { response: { path: ["assignment", "videoId"], equals: videoId } } })).toBe(0);
  }
  async function assertOldReviewGenerationDenied(seed: Awaited<ReturnType<typeof fixture>>) {
    const row = await db.client.expertAssignment.findFirstOrThrow({ where: { videoId: seed.video.id } });
    await expect(db.client.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${seed.owner.id} FOR UPDATE`;
      await app.get(ConsentAccessService).requireInTransaction(tx, seed.owner.id, ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"]);
      await app.get(ConsentAccessService).requireGenerationInTransaction(tx, seed.owner.id,
        row.reviewConsentSubjectId, row.reviewConsentVersion, "EXPERT_VIDEO_REVIEW");
    })).rejects.toMatchObject({ status: 403 });
  }
  it("waits for expiry in UTC even when PostgreSQL uses a non-UTC session timezone", async () => {
    await db.client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Bangkok'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '2s'");
      const [clock] = await tx.$queryRaw<{ at: Date }[]>
        `SELECT (clock_timestamp() AT TIME ZONE 'UTC' + interval '150 milliseconds')::timestamp(3) AS at`;
      await passDeadline(clock.at, tx);
      const [result] = await tx.$queryRaw<{ elapsed: boolean }[]>
        `SELECT (clock_timestamp() AT TIME ZONE 'UTC') >= (${clock.at}::timestamptz AT TIME ZONE 'UTC') AS elapsed`;
      expect(result.elapsed).toBe(true);
    }, { timeout: 5000 });
  });
  it("creates one assignment with bound consent, approval, retained actor, immutable event and audit", async () => {
    const seed = await fixture(), result = await create(seed);
    const row = await db.client.expertAssignment.findUniqueOrThrow({ where: { id: result.assignment.id } });
    const ledger = await db.client.consentLedger.findUniqueOrThrow({ where: { userId: seed.owner.id } });
    expect(row).toMatchObject({ status: "ASSIGNED", revision: 0n, reviewConsentSubjectId: ledger.subjectId, reviewConsentVersion: 1n, dueAt: null, expiresAt: null });
    const event = await db.client.assignmentEvent.findFirstOrThrow({ where: { assignmentId: row.id } });
    expect(event).toMatchObject({ revision: 0n, fromStatus: null, toStatus: "ASSIGNED", credentialApprovalId: row.credentialApprovalId });
    expect(event.snapshot).toMatchObject({ reviewConsentSubjectId: ledger.subjectId, reviewConsentVersion: 1 });
    expect(await db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED", subjectId: row.id } })).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/bucket|objectKey|subjectId|token|sha256|eventTransactionId/);
    await expect(db.client.assignmentEvent.delete({ where: { id: event.id } })).rejects.toThrow("append-only");
    await expect(db.client.$executeRaw`UPDATE "ExpertAssignment" SET "reviewConsentVersion"=2 WHERE id=${row.id}`).rejects.toThrow("binding is immutable");
  });
  it("denies non-moderators, inactive/unverified/revoked/expired sessions and forged authority", async () => {
    const seed = await fixture();
    expect((await request("", seed.body)).status).toBe(401);
    for (const role of ["MEMBER", "EXPERT", "ADMIN"] as const) expect((await request((await user(role)).cookie, seed.body)).status).toBe(403);
    for (const status of ["PENDING_EMAIL", "SUSPENDED", "DELETED"] as const) expect((await request((await user("MODERATOR", status)).cookie, seed.body)).status).toBe(401);
    expect((await request((await user("MODERATOR", "ACTIVE", false)).cookie, seed.body)).status).toBe(401);
    await db.client.session.updateMany({ where: { userId: seed.moderator.id }, data: { revokedAt: new Date() } });
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(401);
    const expired = await user("MODERATOR");
    await db.client.session.updateMany({ where: { userId: expired.id }, data: { expiresAt: new Date(0) } });
    expect((await request(expired.cookie, seed.body)).status).toBe(401);
    expect(await db.client.expertAssignment.count({ where: { videoId: seed.video.id } })).toBe(0);
  });
  it("requires Origin/JSON, valid key, strict fields and private responses", async () => {
    const seed = await fixture();
    const denied = await request(seed.moderator.cookie, seed.body, randomUUID(), { Origin: "https://evil.invalid" });
    expect(denied.status).toBe(403); expect(denied.headers.get("cache-control")).toContain("no-store");
    expect((await request(seed.moderator.cookie, seed.body, randomUUID(), { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await request(seed.moderator.cookie, seed.body, "short")).status).toBe(400);
    for (const field of ["assignedById", "mfaVerified", "reviewConsentVersion"])
      expect((await request(seed.moderator.cookie, { ...seed.body, [field]: "forged" })).status).toBe(400);
    expect((await request(seed.moderator.cookie, seed.body, randomUUID(), {}, "assignments?actorId=forged")).status).toBe(400);
  });
  it("rejects absent, non-READY, deleted and ineligible-owner videos", async () => {
    const seed = await fixture();
    expect((await request(seed.moderator.cookie, { ...seed.body, videoId: "missing" })).status).toBe(404);
    for (const status of ["UPLOADING", "UNDER_REVIEW", "DELETED"] as const) {
      await db.client.video.update({ where: { id: seed.video.id }, data: { status } });
      expect((await request(seed.moderator.cookie, seed.body)).status).toBe(403);
    }
    await db.client.video.update({ where: { id: seed.video.id }, data: { status: "READY", deletedAt: new Date() } });
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(403);
    await db.client.video.update({ where: { id: seed.video.id }, data: { deletedAt: null } });
    await db.client.user.update({ where: { id: seed.owner.id }, data: { status: "SUSPENDED" } });
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(403);
  });
  it("requires both current consents and rejects a withdrawn storage generation after re-grant", async () => {
    for (const purpose of ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"] as const) {
      const seed = await fixture();
      await patchConsent(seed.owner.id, 1, purpose, false);
      expect((await request(seed.moderator.cookie, seed.body)).status).toBe(403);
      await patchConsent(seed.owner.id, 2, purpose, true);
      const response = await request(seed.moderator.cookie, seed.body);
      expect(response.status).toBe(purpose === "VIDEO_STORAGE" ? 409 : 201);
    }
    const seed = await fixture();
    await db.client.video.update({ where: { id: seed.video.id }, data: { storageConsentVersion: null } });
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(409);
    await db.client.video.update({ where: { id: seed.video.id }, data: { storageConsentVersion: 999n } });
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(409);
  });
  it("never reactivates a review generation after withdrawal/re-consent or idempotent replay", async () => {
    const seed = await fixture(), key = randomUUID(), result = await create(seed, key);
    const row = await db.client.expertAssignment.findUniqueOrThrow({ where: { id: result.assignment.id } });
    await patchConsent(seed.owner.id, 1, "EXPERT_VIDEO_REVIEW", false);
    await patchConsent(seed.owner.id, 2, "EXPERT_VIDEO_REVIEW", true);
    await expect(db.client.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${seed.owner.id} FOR UPDATE`;
      await app.get(ConsentAccessService).requireInTransaction(tx, seed.owner.id, ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"]);
      await app.get(ConsentAccessService).requireGenerationInTransaction(tx, seed.owner.id, row.reviewConsentSubjectId, row.reviewConsentVersion, "EXPERT_VIDEO_REVIEW");
    })).rejects.toMatchObject({ status: 403 });
    const replay = await request(seed.moderator.cookie, seed.body, key);
    expect(replay.status).toBe(201); expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(await replay.json()).toEqual(result);
    expect(await db.client.assignmentEvent.count({ where: { assignmentId: row.id } })).toBe(1);
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(409);
  });
  it.each(["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] as const)("C036 replays a historical receipt after DB cancellation from %s without touching the replacement", async status => {
    const seed = await fixture(), key = randomUUID(), original = await create(seed, key);
    const id = original.assignment.id;
    let revision = 0n;
    // Valid database lifecycle fixture only: no cancellation API or C051 worker exists.
    if (status !== "ASSIGNED") await transition(db.client, id, revision++, "IN_PROGRESS");
    if (status === "SUBMITTED") await transition(db.client, id, revision++, "SUBMITTED");
    await transition(db.client, id, revision, "CANCELLED");
    const cancelled = await db.client.expertAssignment.findUniqueOrThrow({ where: { id } });
    const history = await db.client.assignmentEvent.findMany({ where: { assignmentId: id }, orderBy: { revision: "asc" } });
    expect(history.at(-1)).toMatchObject({ fromStatus: status, toStatus: "CANCELLED", revision: revision + 1n });
    // A new create after cancellation is not an atomic reassignment endpoint.
    const replacement = await create(seed);
    expect(replacement.assignment.id).not.toBe(id);
    const before = {
      assignments: await db.client.expertAssignment.findMany({ where: { videoId: seed.video.id }, orderBy: { id: "asc" } }),
      events: await db.client.assignmentEvent.findMany({ where: { assignmentId: { in: [id, replacement.assignment.id] } }, orderBy: { id: "asc" } }),
      receipts: await db.client.assignmentIdempotency.findMany({ where: { assignmentId: { in: [id, replacement.assignment.id] } }, orderBy: { assignmentId: "asc" } }),
      audits: await db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED", subjectId: { in: [id, replacement.assignment.id] } } }),
    };
    const replies = await Promise.all([request(seed.moderator.cookie, seed.body, key), request(seed.moderator.cookie, seed.body, key)]);
    for (const reply of replies) {
      expect(reply.status).toBe(201);
      expect(reply.headers.get("idempotency-replayed")).toBe("true");
      expect(await reply.json()).toEqual(original);
    }
    expect(await db.client.expertAssignment.findMany({ where: { videoId: seed.video.id }, orderBy: { id: "asc" } })).toEqual(before.assignments);
    expect(await db.client.assignmentEvent.findMany({ where: { assignmentId: { in: [id, replacement.assignment.id] } }, orderBy: { id: "asc" } })).toEqual(before.events);
    expect(await db.client.assignmentIdempotency.findMany({ where: { assignmentId: { in: [id, replacement.assignment.id] } }, orderBy: { assignmentId: "asc" } })).toEqual(before.receipts);
    expect(await db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED", subjectId: { in: [id, replacement.assignment.id] } } })).toBe(before.audits);
    expect(await db.client.expertAssignment.findUnique({ where: { id } })).toEqual(cancelled);
    const changed = await request(seed.moderator.cookie, { ...seed.body, dueAt: "2090-01-01T00:00:00.000Z" }, key);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(await db.client.expertAssignment.count({ where: { videoId: seed.video.id, status: { in: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] } } })).toBe(1);
  });
  it("replays the original receipt after soft or hard video deletion without restoring rows or events", async () => {
    const seed = await fixture(), key = randomUUID(), result = await create(seed, key);
    await db.client.video.update({ where: { id: seed.video.id }, data: { status: "DELETED", deletedAt: new Date() } });
    expect(await (await request(seed.moderator.cookie, seed.body, key)).json()).toEqual(result);
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(403);
    await db.client.video.delete({ where: { id: seed.video.id } });
    expect(await (await request(seed.moderator.cookie, seed.body, key)).json()).toEqual(result);
    expect(await db.client.expertAssignment.count({ where: { id: result.assignment.id } })).toBe(0);
    expect(await db.client.assignmentEvent.count({ where: { assignmentId: result.assignment.id } })).toBe(1);
  });
  it("rejects stale or ineligible expert credentials and missing authoritative evidence", async () => {
    const seed = await fixture();
    expect((await request(seed.moderator.cookie, { ...seed.body, expectedCredentialRevision: 0 })).status).toBe(409);
    records.delete(seed.trainingEvidenceId);
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(503);
    await db.client.user.update({ where: { id: seed.expert.id }, data: { status: "SUSPENDED" } });
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(403);
    expect((await request(seed.moderator.cookie, { ...seed.body, expertId: seed.owner.id })).status).toBe(403);
  });
  it("rejects bilateral blocks and does not invent workload restrictions", async () => {
    const seed = await fixture();
    for (const [blockerId, blockedId] of [[seed.owner.id, seed.expert.id], [seed.expert.id, seed.owner.id]]) {
      const block = await db.client.block.create({ data: { blockerId, blockedId } });
      expect((await request(seed.moderator.cookie, seed.body)).status).toBe(403);
      await db.client.block.delete({ where: { id: block.id } });
    }
    await create(seed);
    const second = await db.client.video.create({ data: { ownerId: seed.owner.id, bucket: "synthetic", objectKey: randomUUID(), mimeType: "video/mp4", status: "READY", storageConsentVersion: 1n } });
    expect((await request(seed.moderator.cookie, { ...seed.body, videoId: second.id })).status).toBe(201);
  });
  it("accepts null or future bounded dates; rejects past, reversed and overlong access expiry", async () => {
    const seed = await fixture("2098-01-01T00:00:00.000Z");
    for (const patch of [{ dueAt: "2000-01-01T00:00:00.000Z" }, { expiresAt: "2000-01-01T00:00:00.000Z" },
      { dueAt: "2097-01-01T00:00:00.000Z", expiresAt: "2096-01-01T00:00:00.000Z" }, { expiresAt: "2099-01-01T00:00:00.000Z" }])
      expect((await request(seed.moderator.cookie, { ...seed.body, ...patch })).status).toBe(400);
    expect((await request(seed.moderator.cookie, { ...seed.body, dueAt: "2096-01-01T00:00:00.000Z", expiresAt: "2097-01-01T00:00:00.000Z" })).status).toBe(201);
  });
  it("canonicalizes payloads, rejects changed payloads and scopes keys by actor", async () => {
    const seed = await fixture(), key = randomUUID(), original = await create(seed, key);
    const replay = await request(seed.moderator.cookie, { expiresAt: null, dueAt: null, expectedCredentialRevision: 1, expertId: seed.expert.id, videoId: seed.video.id }, key);
    expect(await replay.json()).toEqual(original);
    expect((await request(seed.moderator.cookie, { ...seed.body, dueAt: "2097-01-01T00:00:00.000Z" }, key)).status).toBe(409);
    const other = await user("MODERATOR");
    expect((await request(other.cookie, seed.body, key)).status).toBe(409);
    const anotherVideo = await db.client.video.create({ data: { ownerId: seed.owner.id, bucket: "synthetic", objectKey: randomUUID(),
      mimeType: "video/mp4", status: "READY", storageConsentVersion: 1n } });
    // A different actor can commit a different payload under the same literal
    // key. Merely conflicting on the original active video would not prove scope.
    expect((await request(other.cookie, { ...seed.body, videoId: anotherVideo.id }, key)).status).toBe(201);
    const row = await db.client.assignmentIdempotency.findFirstOrThrow({ where: { assignmentId: original.assignment.id } });
    expect(row.keyHash).not.toBe(key);
    await expect(db.client.assignmentIdempotency.delete({ where: { actorSubjectId_operation_keyHash: { actorSubjectId: row.actorSubjectId, operation: row.operation, keyHash: row.keyHash } } })).rejects.toThrow("append-only");
  });
  it("serializes duplicate requests and concurrent independent assignments with one event", async () => {
    for (const sameKey of [true, false]) {
      const seed = await fixture(), key = randomUUID();
      const secondCookie = sameKey ? seed.moderator.cookie : (await user("MODERATOR")).cookie;
      const responses = await Promise.all([request(seed.moderator.cookie, seed.body, key), request(secondCookie, seed.body, sameKey ? key : randomUUID())]);
      expect(responses.map(r => r.status).sort()).toEqual(sameKey ? [201, 201] : [201, 409]);
      const rows = await db.client.expertAssignment.findMany({ where: { videoId: seed.video.id } });
      expect(rows).toHaveLength(1);
      expect(await db.client.assignmentEvent.count({ where: { assignmentId: rows[0].id } })).toBe(1);
      expect(await db.client.assignmentIdempotency.count({ where: { assignmentId: rows[0].id } })).toBe(1);
    }
  });
  it("keeps SUBMITTED active and never reassigns or mutates the existing assignment", async () => {
    const seed = await fixture(), result = await create(seed);
    await transition(db.client, result.assignment.id, 0n, "IN_PROGRESS");
    await transition(db.client, result.assignment.id, 1n, "SUBMITTED");
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(409);
    expect(await db.client.expertAssignment.findUnique({ where: { id: result.assignment.id } })).toMatchObject({ status: "SUBMITTED", revision: 2n });
  });
  it("rolls back assignment, event, identity reservation, audit and receipt if final persistence fails", async () => {
    const seed = await fixture();
    const assigningModerator = await user("MODERATOR");
    const counts = await Promise.all([db.client.expertAssignment.count(), db.client.assignmentEvent.count(), db.client.expertAssignmentIdentity.count(),
      db.client.auditLog.count(), db.client.assignmentIdempotency.count()]);
    await db.client.$executeRawUnsafe(`CREATE FUNCTION c033_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic idempotency failure'; END $$`);
    await db.client.$executeRawUnsafe('CREATE TRIGGER c033_test_failure BEFORE INSERT ON "AssignmentIdempotency" FOR EACH ROW EXECUTE FUNCTION c033_test_failure()');
    try {
      expect((await request(assigningModerator.cookie, seed.body)).status).toBe(503);
      expect(await db.client.expertActorIdentity.findUnique({ where: { userId: assigningModerator.id } })).toBeNull();
      expect(await Promise.all([db.client.expertAssignment.count(), db.client.assignmentEvent.count(), db.client.expertAssignmentIdentity.count(),
        db.client.auditLog.count(), db.client.assignmentIdempotency.count()])).toEqual(counts);
    } finally {
      await db.client.$executeRawUnsafe('DROP TRIGGER c033_test_failure ON "AssignmentIdempotency"');
      await db.client.$executeRawUnsafe('DROP FUNCTION c033_test_failure()');
    }
    await create({ ...seed, moderator: assigningModerator });
  });
  it("rejects missing, revoked, unverified or wrong-role experts without provisioning credentials", async () => {
    const seed = await fixture();
    const missing = await user("EXPERT");
    expect((await request(seed.moderator.cookie, { ...seed.body, expertId: missing.id })).status).toBe(403);
    for (const data of [{ emailVerifiedAt: null }, { role: "MEMBER" as const }]) {
      await db.client.user.update({ where: { id: seed.expert.id }, data });
      expect((await request(seed.moderator.cookie, seed.body)).status).toBe(403);
    }
    await db.client.user.update({ where: { id: seed.expert.id }, data: { role: "EXPERT", emailVerifiedAt: new Date() } });
    await db.client.$transaction(async tx => {
      const row = await tx.expertCredential.update({ where: { userId: seed.expert.id }, data: { status: "REVOKED", revokedAt: new Date(), revision: 2n } });
      await credentialEvent(tx, row, "REVOKED", "Synthetic revocation");
    });
    expect((await request(seed.moderator.cookie, { ...seed.body, expectedCredentialRevision: 2 })).status).toBe(403);
    expect(await db.client.expertCredential.findUnique({ where: { userId: missing.id } })).toBeNull();
  });
  it("checks actual credential expiry and independently caps assignment expiry by evidence validity", async () => {
    const seed = await fixture();
    const credential = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: seed.expert.id }, include: { approval: true } });
    const old = credential.approval!;
    await db.client.$transaction(async tx => {
      const approval = await tx.expertCredentialApproval.create({ data: { subjectId: credential.subjectId, trainingVersion: old.trainingVersion,
        policyVersion: old.policyVersion, trainingEvidence: old.trainingEvidence!, confidentialityEvidence: old.confidentialityEvidence!,
        verifiedByEvidence: old.verifiedByEvidence!, approvedByEvidence: old.approvedByEvidence!,
        verifiedAt: new Date("2026-01-01"), approvedAt: new Date("2026-01-01"), expiresAt: new Date("2026-01-02") } });
      const row = await tx.expertCredential.update({ where: { userId: seed.expert.id }, data: { approvalId: approval.id, revision: 2n } });
      await credentialEvent(tx, row, "APPROVED");
    });
    expect((await request(seed.moderator.cookie, { ...seed.body, expectedCredentialRevision: 2 })).status).toBe(503);
    const bounded = await fixture(null, new Date("2098-01-01"));
    expect((await request(bounded.moderator.cookie, { ...bounded.body, expiresAt: "2099-01-01T00:00:00.000Z" })).status).toBe(400);
    await create(bounded);
  });
  it("proves competing mutations wait on PostgreSQL locks when assignment wins", async () => {
    for (const operation of ["delete", "withdraw", "reapprove"] as const) {
      const seed = await fixture();
      const before = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: seed.expert.id } });
      const key = randomUUID();
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const barrier = new Promise<void>(resolve => { release = resolve; });
      let held = false;
      const spy = jest.spyOn(app.get(ExpertEvidenceSource), "find").mockImplementation(async id => {
        if (!held) { held = true; entered(); await barrier; }
        return records.get(id);
      });
      try {
        const creating = request(seed.moderator.cookie, seed.body, key);
        await started; // C033 holds the shared owner/expert/moderator locks here.
        const changing = operation === "delete" ? app.get(VideoService).remove(seed.owner.id, seed.video.id) :
          operation === "withdraw" ? patchConsent(seed.owner.id, 1, "EXPERT_VIDEO_REVIEW", false) :
          request(seed.moderator.cookie, { expectedRevision: 1, trainingVersion, policyVersion: confidentialityVersion,
            trainingEvidenceId: seed.trainingEvidenceId, confidentialityEvidenceId: seed.confidentialityEvidenceId, expiresAt: null },
          randomUUID(), {}, `experts/${seed.expert.id}/approvals`);
        // Do not release on a timer or merely after starting a Promise. The
        // competing backend must actually be waiting for this schema's User lock.
        expect((await waitForUserContention()).length).toBeGreaterThan(0);
        release();
        const created = await creating; expect(created.status).toBe(201);
        const originalResult = await created.json();
        const changed = await changing;
        if (changed instanceof Response) expect(changed.status).toBe(201);
        const row = await db.client.expertAssignment.findFirstOrThrow({ where: { videoId: seed.video.id } });
        expect(row.credentialApprovalId).toBe(before.approvalId);
        if (operation === "delete") {
          expect((await request(seed.moderator.cookie, seed.body)).status).toBe(403);
          expect(await db.client.videoCleanupTask.findUnique({ where: { videoId: seed.video.id } })).toMatchObject({ status: "PENDING" });
        }
        if (operation === "withdraw") {
          expect((await request(seed.moderator.cookie, seed.body)).status).toBe(403);
          await patchConsent(seed.owner.id, 2, "EXPERT_VIDEO_REVIEW", true);
          await assertOldReviewGenerationDenied(seed);
        }
        if (operation === "reapprove") {
          expect((await db.client.expertCredential.findUniqueOrThrow({ where: { userId: seed.expert.id } })).revision).toBe(2n);
          expect((await request(seed.moderator.cookie, seed.body)).status).toBe(409);
        }
        const replay = await request(seed.moderator.cookie, seed.body, key);
        expect(replay.status).toBe(201);
        expect(replay.headers.get("idempotency-replayed")).toBe("true");
        expect(await replay.json()).toEqual(originalResult);
        expect(await db.client.assignmentEvent.count({ where: { assignmentId: row.id } })).toBe(1);
        // C051 is not implemented here: these checks must not pretend cancellation.
        expect(row).toMatchObject({ status: "ASSIGNED", revision: 0n });
      } finally { release(); spy.mockRestore(); }
    }
  });
  it("proves assignment waits for deletion, withdrawal or reapproval to commit first", async () => {
    for (const operation of ["delete", "withdraw", "reapprove"] as const) {
      const seed = await fixture(), entered = gate(), finish = gate();
      const beforeAudit = await db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED" } });
      let blockerPid = 0;
      const original = db.client.$transaction.bind(db.client) as unknown as
        (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) => Promise<unknown>;
      // Hold the real domain mutation after its complete callback but before
      // COMMIT. No synthetic replacement of withdrawal/deletion logic is used.
      const spy = jest.spyOn(db.client, "$transaction").mockImplementationOnce((async (work: unknown, options?: object) => {
        if (typeof work !== "function") throw new Error("Expected interactive transaction");
        return original(async tx => {
          const result = await work(tx);
          const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          blockerPid = backend.pid; entered.release(); await finish.promise;
          return result;
        }, options);
      }) as unknown as typeof db.client.$transaction);
      let creating: ReturnType<typeof request> | undefined;
      let changing: Promise<unknown> | undefined;
      try {
        changing = operation === "delete" ? app.get(VideoService).remove(seed.owner.id, seed.video.id) :
          operation === "withdraw" ? patchConsent(seed.owner.id, 1, "EXPERT_VIDEO_REVIEW", false) :
          request(seed.moderator.cookie, { expectedRevision: 1, trainingVersion, policyVersion: confidentialityVersion,
            trainingEvidenceId: seed.trainingEvidenceId, confidentialityEvidenceId: seed.confidentialityEvidenceId, expiresAt: null },
          randomUUID(), {}, `experts/${seed.expert.id}/approvals`);
        await entered.promise;
        creating = request(seed.moderator.cookie, seed.body);
        const waiting = await waitForUserContention(blockerPid);
        expect(waiting.every(row => row.blockers.includes(blockerPid))).toBe(true);
        finish.release();
        const changed = await changing;
        if (changed instanceof Response) expect(changed.status).toBe(201);
        expect((await creating).status).toBe(operation === "reapprove" ? 409 : 403);
        await expectNoAssignmentSuccess(seed.video.id);
        expect(await db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED" } })).toBe(beforeAudit);
        if (operation === "withdraw") {
          await patchConsent(seed.owner.id, 2, "EXPERT_VIDEO_REVIEW", true);
          const fresh = await create(seed);
          expect(await db.client.expertAssignment.findUnique({ where: { id: fresh.assignment.id } })).toMatchObject({ reviewConsentVersion: 3n });
        }
        if (operation === "reapprove") {
          const fresh = await request(seed.moderator.cookie, { ...seed.body, expectedCredentialRevision: 2 });
          expect(fresh.status).toBe(201);
        }
      } finally {
        finish.release(); spy.mockRestore();
        await Promise.allSettled([...(creating ? [creating] : []), ...(changing ? [changing] : [])]);
      }
    }
  });
  it.each(["session", "qualification", "evidence", "dueAt", "expiresAt"] as const)(
    "rejects %s expiry during asynchronous evidence I/O without committing success", async condition => {
      const deadline = await futureClock(5000);
      const seed = await fixture(condition === "qualification" ? deadline.toISOString() : null,
        condition === "evidence" ? deadline : null);
      if (condition === "session") await db.client.session.updateMany({ where: { userId: seed.moderator.id }, data: { expiresAt: deadline } });
      const body = { ...seed.body, ...(condition === "dueAt" ? { dueAt: deadline.toISOString() } : {}),
        ...(condition === "expiresAt" ? { expiresAt: deadline.toISOString() } : {}) };
      const entered = gate(), finish = gate(); let held = false;
      const spy = jest.spyOn(app.get(ExpertEvidenceSource), "find").mockImplementation(async id => {
        if (!held) { held = true; entered.release(); await finish.promise; }
        return records.get(id);
      });
      const beforeAudit = await db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED" } });
      const creating = request(seed.moderator.cookie, body);
      try {
        await entered.promise;
        await passDeadline(deadline); finish.release();
        const response = await creating;
        expect(response.status).toBe(condition === "session" ? 401 : ["dueAt", "expiresAt"].includes(condition) ? 400 : 503);
        await expectNoAssignmentSuccess(seed.video.id);
        expect(await db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED" } })).toBe(beforeAudit);
      } finally { finish.release(); spy.mockRestore(); await creating; }
    });
  it("rejects session expiry while waiting on a proven PostgreSQL User lock", async () => {
    const seed = await fixture(), deadline = await futureClock();
    await db.client.session.updateMany({ where: { userId: seed.moderator.id }, data: { expiresAt: deadline } });
    const entered = gate(), finish = gate(); let pid = 0;
    const blocking = db.client.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${seed.owner.id} FOR UPDATE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pid = backend.pid; entered.release(); await finish.promise;
    }, { timeout: 10000 });
    await entered.promise;
    const beforeAudit = await db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED" } });
    const creating = request(seed.moderator.cookie, seed.body);
    try {
      expect((await waitForUserContention(pid)).length).toBeGreaterThan(0);
      await passDeadline(deadline); finish.release(); await blocking;
      expect((await creating).status).toBe(401);
      await expectNoAssignmentSuccess(seed.video.id);
      expect(await db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED" } })).toBe(beforeAudit);
    } finally { finish.release(); await Promise.allSettled([blocking, creating]); }
  });
  it("denies real-policy records even in test mode and keeps production closed without real staff assurance", async () => {
    testOnly = false;
    const seed = await fixture();
    expect((await request(seed.moderator.cookie, seed.body)).status).toBe(503);
    Object.assign(app.get(EnvironmentService).values, { nodeEnv: "production" });
    const response = await request(seed.moderator.cookie, seed.body);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "ASSIGNMENT_ASSURANCE_UNAVAILABLE" });
    expect(await db.client.expertAssignment.count({ where: { videoId: seed.video.id } })).toBe(0);
  });
});
