import { AssignmentAccessService } from "../src/expert-admin/assignment-access.service";
import { ExpertMfaSource } from "../src/expert-admin/expert-mfa.source";
import { PrivateStorageService } from "../src/video/private-storage.service";
import { ExpertPlaybackLimiter } from "../src/expert-admin/expert-playback-request.guard";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AccountStatus, Prisma, PrismaClient, UserRole } from "@prisma/client";
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
import { transition, credentialEvent, assignmentEvent } from "./expert-db-fixtures";


// Prisma binds Date parameters as timestamptz. Normalize them explicitly to UTC
// before comparing with the UTC timestamp clock; never use a session-local cast.
// Call only inside a test-owned transaction: timeout resets on commit/rollback.
async function waitForDeadline(tx: Prisma.TransactionClient, deadline: Date) {
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
  await tx.$queryRaw`SELECT true AS elapsed FROM pg_sleep(GREATEST(0,
    EXTRACT(EPOCH FROM ((${deadline}::timestamptz AT TIME ZONE 'UTC') -
      (clock_timestamp() AT TIME ZONE 'UTC'))))::double precision + 0.05)`;
}

describe("C034 assignment-bound playback / disposable PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>, app: INestApplication, base: string;
  let records: Map<string, ExpertEvidence>, policyVersion: string, testOnly: boolean;
  const origin = "http://localhost:3000", trainingVersion = "synthetic-training-v1", confidentialityVersion = "synthetic-confidentiality-v1";
  beforeAll(async () => { db = await createAuthDatabase(); }, 60000);
  beforeEach(async () => {
    if (process.env.NODE_ENV !== "test" || !/^vera_auth_test_[a-f0-9]{32}$/.test(db.schema)) throw new Error("Disposable test schema required");
    records = new Map(); policyVersion = `synthetic-${randomUUID()}`; testOnly = true;
    const values = parseEnvironment({ ...process.env, NODE_ENV: "test", DATABASE_URL: db.url, CORS_ORIGIN: origin,
      MINIO_ROOT_USER: "synthetic-test", MINIO_ROOT_PASSWORD: "synthetic-test-only", MINIO_BUCKET: "synthetic-private" });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EnvironmentService).useValue({ values })
      .overrideProvider(PrismaService).useValue(db.client)
      .overrideProvider(ExpertMfaSource).useValue({ resolve: async (auth: { sessionId: string; user: { id: string } }) => ({
        userId: auth.user.id, sessionId: auth.sessionId, expiresAt: new Date(Date.now() + 600000), testOnly: true }) })
      .overrideProvider(ConsentPolicyRegistry).useValue({ current: (purpose: string) => ({ purpose, policyVersion, locale: "en",
        content: `SYNTHETIC ${purpose} POLICY`, testOnly }) })
      .overrideProvider(ExpertApprovalRegistry).useValue({ training: (version: string) => version === trainingVersion ? { version, content: "SYNTHETIC TRAINING" } : undefined,
        confidentiality: (version: string) => version === confidentialityVersion ? { version, content: "SYNTHETIC CONFIDENTIALITY" } : undefined })
      .overrideProvider(ExpertEvidenceSource).useValue({ find: async (id: string) => records.get(id) }).compile();
    app = module.createNestApplication({ logger: false }); configureApplication(app); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
    // Real SigV4 presigner, synthetic credentials; bucket HTTP checks need MinIO and
    // are separately covered by the existing real-storage suite when available.
    jest.spyOn(app.get(PrivateStorageService), "assertPrivate").mockResolvedValue(undefined);
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
    const body: { videoId: string; expertId: string; expectedCredentialRevision: number; dueAt: string | null; expiresAt: string | null } =
      { videoId: video.id, expertId: expert.id, expectedCredentialRevision: 1, dueAt: null, expiresAt: null };
    return { moderator, owner, expert, video, body, trainingEvidenceId, confidentialityEvidenceId };
  }
  async function create(seed: Awaited<ReturnType<typeof fixture>>, key = randomUUID()) {
    const response = await request(seed.moderator.cookie, seed.body, key);
    expect(response.status).toBe(201);
    return await response.json() as { assignment: { id: string; status: string; revision: number } };
  }
  function access(mfa: ExpertMfaSource = app.get(ExpertMfaSource)) {
    return new AssignmentAccessService(db.client as unknown as PrismaService, app.get(ConsentAccessService),
      app.get(EnvironmentService), app.get(ExpertApprovalRegistry), app.get(ExpertEvidenceSource), mfa);
  }
  async function context(id: string) {
    const session = await db.client.session.findFirstOrThrow({ where: { userId: id } });
    const row = await db.client.user.findUniqueOrThrow({ where: { id } });
    return { sessionId: session.id, user: { id, email: row.email, displayName: row.displayName, role: row.role } };
  }
  const playback = (cookie: string, id: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/expert/assignments/${id}/playback`, { method: "POST", headers: { Cookie: cookie, Origin: origin,
      "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  function privateHeaders(response: Response) {
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  }
  const draftRequest = (cookie: string, path: string, method = "GET", body?: unknown) =>
    fetch(`${base}/api/expert/${path}`, { method, headers: {
      Cookie: cookie, Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
  const draftPath = (id: string) => `assignments/${id}/draft`;
  const savePath = (id: string) => `reviews/${id}/draft`;
  const observation = { category: "EYE", startMs: 0, endMs: 1000, observation: "Looks left.", context: "During the opening prompt." };

  async function draftJson(response: Response) {
    expect(response.status).toBe(200);
    return await response.json() as { draft: { id: string; version: number; observations: { category: string }[] }; durationMs: number };
  }

  async function reviewFixture() {
    const seed = await fixture(), { assignment } = await create(seed);
    const path = draftPath(assignment.id);
    await db.client.video.update({ where: { id: seed.video.id }, data: { durationMs: 5000 } });
    return { ...seed, path, assignment };
  }

  test("T08 initializes once and persists all five categories across independent HTTP reads", async () => {
    const { expert, path, assignment } = await reviewFixture();
    const empty = await draftRequest(expert.cookie, path);
    expect(empty.status).toBe(200); privateHeaders(empty);
    expect(await empty.json()).toEqual({ draft: null, durationMs: 5000 });
    expect(await db.client.expertReview.count({ where: { assignmentId: assignment.id } })).toBe(0);
    const openings = await Promise.all([0, 1].map(() => draftRequest(expert.cookie, path, "POST", {})));
    expect(openings.map(response => response.status)).toEqual([200, 200]);
    const [first, second] = await Promise.all(openings.map(draftJson));
    expect(second.draft.id).toBe(first.draft.id);
    const categories = ["EYE", "FACIAL", "BODY", "SPEECH", "CROSS_MODAL"];
    const saved = await draftRequest(expert.cookie, savePath(first.draft.id), "PATCH", {
      expectedVersion: 1, observations: categories.map((category, index) => ({ ...observation, category, startMs: index * 1000, endMs: (index + 1) * 1000 })),
    });
    expect(saved.status).toBe(200);
    const loaded = await draftRequest(expert.cookie, path);
    const result = await draftJson(loaded);
    expect(result.draft.version).toBe(2);
    expect(result.draft.observations.map((row: { category: string }) => row.category)).toEqual(categories);
    expect(Object.keys(result).sort()).toEqual(["draft", "durationMs"]);
  });

  test("T08 rejects out-of-range and forged fields without partial writes, and appends against current version", async () => {
    const { expert, path, video } = await reviewFixture();
    const opening = await draftRequest(expert.cookie, path, "POST", {});
    const { draft } = await draftJson(opening);
    const endpoint = `reviews/${draft.id}/observations`;
    for (const [value, status] of [
      [{ ...observation, endMs: 5001 }, 422],
      [{ ...observation, startMs: -1 }, 422],
      [{ ...observation, endMs: 0.5 }, 422],
      [{ ...observation, context: "  " }, 400],
      [{ ...observation, category: "UNKNOWN" }, 400],
      [{ ...observation, durationMs: 9000 }, 400],
    ] as const) {
      const result = await draftRequest(expert.cookie, endpoint, "POST", { expectedVersion: 1, observation: value });
      expect(result.status).toBe(status); privateHeaders(result);
    }
    await db.client.video.update({ where: { id: video.id }, data: { durationMs: null } });
    const unknown = await draftRequest(expert.cookie, endpoint, "POST", { expectedVersion: 1, observation });
    expect(unknown.status).toBe(503);
    expect(await unknown.json()).toMatchObject({ code: "REVIEW_DURATION_UNAVAILABLE" });
    expect(await db.client.expertObservation.count({ where: { reviewId: draft.id } })).toBe(0);
    expect((await db.client.expertReview.findUniqueOrThrow({ where: { id: draft.id } })).version).toBe(1);
    await db.client.video.update({ where: { id: video.id }, data: { durationMs: 1000 } });
    expect((await draftRequest(expert.cookie, endpoint, "POST", { expectedVersion: 1, observation })).status).toBe(200);
  });

  test("T08 competing draft autosaves have one winner and one stale version denial", async () => {
    const { expert, path } = await reviewFixture();
    const { draft } = await draftJson(await draftRequest(expert.cookie, path, "POST", {}));
    const values = ["first private summary", "second private summary"];
    const responses = await Promise.all(values.map(summary =>
      draftRequest(expert.cookie, savePath(draft.id), "PATCH", { expectedVersion: 1, summary, observations: [observation] })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const loser = responses.find(response => response.status === 409)!;
    expect(await loser.json()).toMatchObject({ code: "REVIEW_VERSION_CONFLICT" });
    expect(await db.client.expertReview.findUniqueOrThrow({ where: { id: draft.id } }))
      .toMatchObject({ version: 2, summary: values[responses.findIndex(response => response.status === 200)] });
    expect(await db.client.expertObservation.count({ where: { reviewId: draft.id } })).toBe(1);
    expect(await db.client.auditLog.count({ where: { subjectId: draft.id, action: "EXPERT_DRAFT_SAVED" } })).toBe(1);
  });

  test("T08 denies foreign, member, moderator and unauthenticated draft access; withdrawal prevents editing after regrant", async () => {
    const { expert, owner, moderator, path } = await reviewFixture();
    const { draft } = await draftJson(await draftRequest(expert.cookie, path, "POST", {}));
    expect((await draftRequest("", path)).status).toBe(401);
    for (const account of [owner, moderator, await user("ADMIN")])
      expect((await draftRequest(account.cookie, path)).status).toBe(403);
    const other = await user("EXPERT");
    expect((await draftRequest(other.cookie, path)).status).toBe(404);
    const patch = { expectedVersion: 1, summary: "Private" };
    const foreign = await draftRequest(other.cookie, savePath(draft.id), "PATCH", patch);
    const missing = await draftRequest(other.cookie, savePath(randomUUID()), "PATCH", patch);
    expect(foreign.status).toBe(404); expect(await foreign.json()).toEqual(await missing.json()); privateHeaders(foreign);
    await patchConsent(owner.id, 1, "EXPERT_VIDEO_REVIEW", false);
    expect((await draftRequest(expert.cookie, path)).status).toBe(403);
    await patchConsent(owner.id, 2, "EXPERT_VIDEO_REVIEW", true);
    expect((await draftRequest(expert.cookie, savePath(draft.id), "PATCH", patch)).status).toBe(403);
    expect((await db.client.expertReview.findUniqueOrThrow({ where: { id: draft.id } })).version).toBe(1);
  });

  test("T08 DB constraints enforce positive versions and ordered timecodes", async () => {
    const { expert, path } = await reviewFixture();
    const { draft } = await draftJson(await draftRequest(expert.cookie, path, "POST", {}));
    await expect(db.client.$executeRaw`UPDATE "ExpertReview" SET version=0 WHERE id=${draft.id}`)
      .rejects.toThrow(/ExpertReview_positive_version/);
    await expect(db.client.$executeRaw`INSERT INTO "ExpertObservation"
      (id,"reviewId",category,"startMs","endMs",observation) VALUES
      (${randomUUID()},${draft.id},'EYE',100,0,'synthetic')`).rejects.toThrow(/ExpertObservation_ordered_timecodes/);
  });

  test("T08 audit failure rolls draft text, observations and version back", async () => {
    const { expert, path } = await reviewFixture();
    const { draft } = await draftJson(await draftRequest(expert.cookie, path, "POST", {}));
    await db.client.$executeRawUnsafe(`CREATE FUNCTION t08_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='EXPERT_DRAFT_SAVED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await db.client.$executeRawUnsafe('CREATE TRIGGER t08_reject_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION t08_reject_audit()');
    try {
      const response = await draftRequest(expert.cookie, savePath(draft.id), "PATCH", {
        expectedVersion: 1, summary: "private draft", observations: [observation],
      });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("synthetic audit failure");
      expect(await db.client.expertReview.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ version: 1, summary: null });
      expect(await db.client.expertObservation.count({ where: { reviewId: draft.id } })).toBe(0);
    } finally {
      await db.client.$executeRawUnsafe('DROP TRIGGER t08_reject_audit ON "AuditLog"');
      await db.client.$executeRawUnsafe("DROP FUNCTION t08_reject_audit()");
    }
  });

  test("HTTP playback signs only the assigned video and records minimum audit without changing status", async () => {
    const seed = await fixture(), result = await create(seed);
    const response = await playback(seed.expert.cookie, result.assignment.id);
    expect(response.status).toBe(200); privateHeaders(response);
    const body = await response.json() as { id: string; url: string; expiresAt: string };
    expect(body.id).toBe(seed.video.id);
    const query = new URL(body.url).searchParams, stamp = query.get("X-Amz-Date")!;
    const signedAt = Date.UTC(+stamp.slice(0,4), +stamp.slice(4,6)-1, +stamp.slice(6,8), +stamp.slice(9,11), +stamp.slice(11,13), +stamp.slice(13,15));
    expect(new Date(body.expiresAt).getTime()).toBe(signedAt + Number(query.get("X-Amz-Expires")) * 1000);
    expect(Number(query.get("X-Amz-Expires"))).toBeLessThanOrEqual(60);
    expect(await db.client.expertAssignment.findUniqueOrThrow({ where: { id: result.assignment.id } })).toMatchObject({ status: "ASSIGNED", revision: 0n });
    expect(await db.client.auditLog.count({ where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: result.assignment.id } })).toBe(1);
  });
  test.each(["ADMIN", "MODERATOR", "MEMBER"] as const)("HTTP denies %s and preserves private headers", async role => {
    const other = await user(role), response = await playback(other.cookie, "unknown");
    expect(response.status).toBe(403); privateHeaders(response);
  });
  test.each(["missing", "expired", "revoked"])("HTTP denies %s session", async state => {
    const expert = await user("EXPERT");
    if (state !== "missing") await db.client.session.updateMany({ where: { userId: expert.id }, data: state === "expired" ? { expiresAt: new Date(0) } : { revokedAt: new Date() } });
    const response = await playback(state === "missing" ? "" : expert.cookie, "unknown");
    expect(response.status).toBe(401); privateHeaders(response);
  });
  test("unknown and another expert's assignment have identical 404 responses", async () => {
    const seed = await fixture(), result = await create(seed), other = await user("EXPERT");
    const missing = await playback(other.cookie, "unknown"), foreign = await playback(other.cookie, result.assignment.id);
    expect(missing.status).toBe(404); expect(foreign.status).toBe(404);
    expect(await missing.json()).toEqual(await foreign.json()); privateHeaders(foreign);
  });
  test.each(["bad!", "with space", "with\u0000null", "a".repeat(201)])("malformed HTTP assignment ID %j returns validation error before lookup", async id => {
    const expert = await user("EXPERT"), lookup = jest.spyOn(db.client.expertAssignment, "findUnique");
    try {
      const response = await playback(expert.cookie, encodeURIComponent(id));
      expect(response.status).toBe(400); privateHeaders(response);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED", details: [{ field: "assignmentId", messages: ["Send a valid identifier."] }] });
      expect(lookup).not.toHaveBeenCalled();
    } finally { lookup.mockRestore(); }
  });
  test.each(["valid_nonexistent-ID", "a".repeat(200)])("valid nonexistent assignment ID returns 404", async id => {
    const expert = await user("EXPERT"), response = await playback(expert.cookie, id);
    expect(response.status).toBe(404); privateHeaders(response);
    expect(await response.json()).toMatchObject({ code: "ASSIGNMENT_NOT_FOUND", message: "Assignment not found." });
  });
  test.each(["IN_PROGRESS", "SUBMITTED", "COMPLETED", "CANCELLED"] as const)("status %s uses the approved read contract", async status => {
    const seed = await fixture(), result = await create(seed);
    if (status === "CANCELLED") await transition(db.client, result.assignment.id, 0n, status);
    else {
      await transition(db.client, result.assignment.id, 0n, "IN_PROGRESS");
      if (status !== "IN_PROGRESS") await transition(db.client, result.assignment.id, 1n, "SUBMITTED");
      if (status === "COMPLETED") await transition(db.client, result.assignment.id, 2n, "COMPLETED");
    }
    const response = await playback(seed.expert.cookie, result.assignment.id);
    expect(response.status).toBe(status === "IN_PROGRESS" ? 200 : 403);
  });
  test.each(["UPLOADING", "UNDER_REVIEW", "DELETED"] as const)("video status %s is denied", async status => {
    const seed = await fixture(), result = await create(seed);
    await db.client.video.update({ where: { id: seed.video.id }, data: { status } });
    expect((await playback(seed.expert.cookie, result.assignment.id)).status).toBe(403);
  });
  test.each(["owner", "expert"] as const)("suspended %s is denied", async target => {
    const seed = await fixture(), result = await create(seed);
    await db.client.user.update({ where: { id: seed[target].id }, data: { status: "SUSPENDED" } });
    expect((await playback(seed.expert.cookie, result.assignment.id)).status).toBe(target === "expert" ? 401 : 403);
  });
  test("revoked credential is denied", async () => {
    const seed = await fixture(), result = await create(seed);
    await db.client.$transaction(async tx => {
      const row = await tx.expertCredential.update({ where: { userId: seed.expert.id }, data: { status: "REVOKED", revokedAt: new Date(), revision: { increment: 1 } } });
      await credentialEvent(tx, row, "REVOKED", "synthetic revocation");
    });
    expect((await playback(seed.expert.cookie, result.assignment.id)).status).toBe(403);
  });
  test("reapproval never rebinds an existing assignment", async () => {
    const seed = await fixture(), result = await create(seed);
    const approved = await request(seed.moderator.cookie, { expectedRevision: 1, trainingVersion, policyVersion: confidentialityVersion,
      trainingEvidenceId: seed.trainingEvidenceId, confidentialityEvidenceId: seed.confidentialityEvidenceId, expiresAt: null }, randomUUID(), {}, `experts/${seed.expert.id}/approvals`);
    expect(approved.status).toBe(201);
    expect((await playback(seed.expert.cookie, result.assignment.id)).status).toBe(403);
  });
  test("audit failure prevents signing and rolls back the success audit", async () => {
    const seed = await fixture(), result = await create(seed), storage = app.get(PrivateStorageService), signed = jest.spyOn(storage, "playbackGrant");
    await db.client.$executeRawUnsafe(`CREATE FUNCTION c034_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='EXPERT_PLAYBACK_ISSUED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await db.client.$executeRawUnsafe(`CREATE TRIGGER c034_reject_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION c034_reject_audit()`);
    try {
      expect((await playback(seed.expert.cookie, result.assignment.id)).status).toBe(503);
      expect(signed).not.toHaveBeenCalled();
      expect(await db.client.auditLog.count({ where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: result.assignment.id } })).toBe(0);
    } finally {
      await db.client.$executeRawUnsafe(`DROP TRIGGER c034_reject_audit ON "AuditLog"`);
      await db.client.$executeRawUnsafe(`DROP FUNCTION c034_reject_audit()`);
    }
  });
  test("owner playback remains MEMBER-only with a 60-second signature", async () => {
    const seed = await fixture(), result = await create(seed);
    const call = (cookie: string) => fetch(`${base}/api/videos/${seed.video.id}/playback`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}" });
    const owner = await call(seed.owner.cookie);
    expect(owner.status).toBe(201);
    expect(new URL((await owner.json() as { url: string }).url).searchParams.get("X-Amz-Expires")).toBe("60");
    expect((await call(seed.expert.cookie)).status).toBe(403);
    expect(result.assignment.id).toBeTruthy();
  });
  test("body/query/origin cannot select TTL or media locators", async () => {
    const seed = await fixture(), result = await create(seed);
    expect((await playback(seed.expert.cookie, result.assignment.id, { ttl: 60, objectKey: "other" })).status).toBe(400);
    expect((await playback(seed.expert.cookie, result.assignment.id, {}, { Origin: "https://attacker.invalid" })).status).toBe(403);
    expect((await playback(seed.expert.cookie, result.assignment.id, {}, { "Content-Type": "text/plain" })).status).toBe(415);
    const malformed = await fetch(`${base}/api/expert/assignments/${result.assignment.id}/playback`, { method: "POST",
      headers: { Cookie: seed.expert.cookie, Origin: origin, "Content-Type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400); privateHeaders(malformed);
  });
  test.each(["session", "mfa", "assignment", "qualification"] as const)("URL lifetime is capped by %s", async bound => {
    const deadline = new Date(Date.now() + 15000);
    const seed = await fixture(bound === "qualification" ? deadline.toISOString() : null);
    if (bound === "assignment") seed.body.expiresAt = deadline.toISOString();
    const result = await create(seed);
    if (bound === "session") await db.client.session.updateMany({ where: { userId: seed.expert.id }, data: { expiresAt: deadline } });
    if (bound === "mfa") jest.spyOn(app.get(ExpertMfaSource), "resolve").mockImplementation(async auth => ({ userId: auth.user.id, sessionId: auth.sessionId, expiresAt: deadline, testOnly: true }));
    const response = await playback(seed.expert.cookie, result.assignment.id);
    expect(response.status).toBe(200);
    const body = await response.json() as { expiresAt: string; url: string };
    expect(new Date(body.expiresAt).getTime()).toBeLessThanOrEqual(deadline.getTime());
    expect(Number(new URL(body.url).searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(15);
  });
  test("evidence expires during asynchronous source lookup, without a success audit or URL", async () => {
    const deadline = new Date(Date.now() + 3000), seed = await fixture(null, deadline), result = await create(seed);
    const source = app.get(ExpertEvidenceSource), original = source.find.bind(source), signer = jest.spyOn(app.get(PrivateStorageService), "playbackGrant");
    jest.spyOn(source, "find").mockImplementationOnce(async id => {
      await db.client.$transaction(tx => waitForDeadline(tx, deadline), { timeout: 7000 });
      return original(id);
    });
    expect((await playback(seed.expert.cookie, result.assignment.id)).status).toBe(503);
    expect(signer).not.toHaveBeenCalled();
    expect(await db.client.auditLog.count({ where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: result.assignment.id } })).toBe(0);
  });
  test("session expires during verified User-lock contention", async () => {
    const seed = await fixture(), result = await create(seed), deadline = new Date(Date.now() + 3000);
    await db.client.session.updateMany({ where: { userId: seed.expert.id }, data: { expiresAt: deadline } });
    let release!: () => void, locked!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { locked = resolve; });
    const holder = db.client.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${seed.owner.id} FOR UPDATE`;
      locked(); await barrier;
    }, { timeout: 10000 });
    await ready;
    const response = playback(seed.expert.cookie, result.assignment.id);
    try {
      const until = Date.now() + 2000;
      let contended = false;
      while (Date.now() < until) {
        const rows = await db.client.$queryRaw<{ pid: number }[]>`SELECT a.pid FROM pg_stat_activity a
          WHERE a.wait_event_type='Lock' AND cardinality(pg_blocking_pids(a.pid))>0
          AND position('FROM "User"' IN a.query)>0 AND position('FOR UPDATE' IN a.query)>0
          AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='"User"'::regclass AND l.mode='RowShareLock')`;
        if (rows.length) { contended = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(contended).toBe(true);
      await db.client.$transaction(tx => waitForDeadline(tx, deadline), { timeout: 7000 });
    } finally { release(); await holder; }
    expect((await response).status).toBe(401);
    expect(await db.client.auditLog.count({ where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: result.assignment.id } })).toBe(0);
  });
  test.each(["missing-review", "future-storage"])("invalid generation %s cannot authorize playback", async kind => {
    const seed = await fixture(), credential = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: seed.expert.id } });
    if (kind === "future-storage") await db.client.video.update({ where: { id: seed.video.id }, data: { storageConsentVersion: 999n } });
    const assignment = await db.client.$transaction(async tx => {
      const row = await tx.expertAssignment.create({ data: { videoId: seed.video.id, expertId: seed.expert.id,
        assignedById: seed.moderator.id, assignedByEvidence: { subject: "synthetic" }, credentialApprovalId: credential.approvalId,
        ...(kind === "missing-review" ? {} : { reviewConsentSubjectId: (await tx.consentLedger.findUniqueOrThrow({ where: { userId: seed.owner.id } })).subjectId, reviewConsentVersion: 1n }) } });
      await assignmentEvent(tx, row.id, null); return row;
    });
    expect((await playback(seed.expert.cookie, assignment.id)).status).toBe(403);
  });
  test("expired MFA and insufficient remaining lifetime deny issuance", async () => {
    const seed = await fixture(), result = await create(seed);
    jest.spyOn(app.get(ExpertMfaSource), "resolve").mockImplementation(async auth => ({ userId: auth.user.id, sessionId: auth.sessionId, expiresAt: new Date(0), testOnly: true }));
    expect((await playback(seed.expert.cookie, result.assignment.id)).status).toBe(403);
  });
  test("HTTP default MFA denial and wrong-session assurance never sign", async () => {
    const seed = await fixture(), result = await create(seed), source = app.get(ExpertMfaSource), signed = jest.spyOn(app.get(PrivateStorageService), "playbackGrant");
    jest.spyOn(source, "resolve").mockResolvedValueOnce(undefined).mockResolvedValueOnce({ userId: seed.expert.id, sessionId: "different-session", expiresAt: new Date(Date.now() + 60000), testOnly: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await playback(seed.expert.cookie, result.assignment.id);
      expect(response.status).toBe(403); privateHeaders(response);
    }
    expect(signed).not.toHaveBeenCalled();
  });
  test("rate limit returns Retry-After with private headers", async () => {
    const expert = await user("EXPERT"), limiter = app.get(ExpertPlaybackLimiter);
    for (let i = 0; i < 60; i++) limiter.consume("expert-playback:expert", expert.id, 60, 60000);
    const response = await playback(expert.cookie, "unknown");
    expect(response.status).toBe(429); privateHeaders(response);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  test("self-review is denied before any consent lookup", async () => {
    const seed = await fixture(), credential = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: seed.expert.id } });
    const video = await db.client.video.create({ data: { ownerId: seed.expert.id, bucket: "synthetic-private", objectKey: randomUUID(), mimeType: "video/mp4", status: "READY", storageConsentVersion: 1n } });
    const assignment = await db.client.$transaction(async tx => {
      const row = await tx.expertAssignment.create({ data: { videoId: video.id, expertId: seed.expert.id, credentialApprovalId: credential.approvalId, assignedByEvidence: { subject: "synthetic-moderator" } } });
      await assignmentEvent(tx, row.id, null); return row;
    });
    const consent = jest.spyOn(app.get(ConsentAccessService), "requireInTransaction");
    expect((await playback(seed.expert.cookie, assignment.id)).status).toBe(403);
    expect(consent).not.toHaveBeenCalled();
  });
  test("valid synthetic authorization stays transaction-bound and writes nothing", async () => {
    const seed = await fixture(), result = await create(seed), action = jest.fn(async () => "authorized");
    const before = await db.client.assignmentEvent.count();
    await expect(access().withAuthorizedAssignment(await context(seed.expert.id), result.assignment.id, action)).resolves.toBe("authorized");
    expect(action).toHaveBeenCalledTimes(1);
    expect(await db.client.assignmentEvent.count()).toBe(before);
  });
  test.each(["ADMIN", "MODERATOR", "MEMBER"] as const)("rejects %s without role inheritance", async role => {
    const seed = await fixture(), result = await create(seed), other = await user(role), action = jest.fn();
    await expect(access().withAuthorizedAssignment(await context(other.id), result.assignment.id, action)).rejects.toMatchObject({ status: 403 });
    expect(action).not.toHaveBeenCalled();
  });
  test("another expert cannot read the assignment", async () => {
    const seed = await fixture(), result = await create(seed), other = await user("EXPERT"), action = jest.fn();
    await expect(access().withAuthorizedAssignment(await context(other.id), result.assignment.id, action)).rejects.toMatchObject({ status: 404 });
    expect(action).not.toHaveBeenCalled();
  });
  test.each(["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"] as const)("%s withdrawal and regrant never resurrect old access", async purpose => {
    const seed = await fixture(), result = await create(seed), auth = await context(seed.expert.id), action = jest.fn();
    await patchConsent(seed.owner.id, 1, purpose, false);
    await expect(access().withAuthorizedAssignment(auth, result.assignment.id, action)).rejects.toMatchObject({ status: 403 });
    await patchConsent(seed.owner.id, 2, purpose, true);
    await expect(access().withAuthorizedAssignment(auth, result.assignment.id, action)).rejects.toMatchObject({ status: 403 });
    expect(action).not.toHaveBeenCalled();
  });
  test.each(["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] as const)("C036 HTTP playback after DB cancellation from %s never signs or changes history", async status => {
    const seed = await fixture(), result = await create(seed), id = result.assignment.id;
    let revision = 0n;
    // Database fixture, not an invocation or simulation of the C051 worker.
    if (status !== "ASSIGNED") await transition(db.client, id, revision++, "IN_PROGRESS");
    if (status === "SUBMITTED") await transition(db.client, id, revision++, "SUBMITTED");
    await transition(db.client, id, revision, "CANCELLED");
    const before = await db.client.expertAssignment.findUniqueOrThrow({ where: { id } });
    const events = await db.client.assignmentEvent.findMany({ where: { assignmentId: id }, orderBy: { revision: "asc" } });
    const receipts = await db.client.assignmentIdempotency.findMany({ where: { assignmentId: id } });
    const signer = jest.spyOn(app.get(PrivateStorageService), "playbackGrant");
    try {
      const response = await playback(seed.expert.cookie, id);
      expect(response.status).toBe(403); privateHeaders(response);
      expect(await response.json()).toMatchObject({ code: "ASSIGNMENT_ACCESS_DENIED" });
      expect(signer).not.toHaveBeenCalled();
      expect(await db.client.auditLog.count({ where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: id } })).toBe(0);
      expect(await db.client.expertAssignment.findUnique({ where: { id } })).toEqual(before);
      expect(await db.client.assignmentEvent.findMany({ where: { assignmentId: id }, orderBy: { revision: "asc" } })).toEqual(events);
      expect(await db.client.assignmentIdempotency.findMany({ where: { assignmentId: id } })).toEqual(receipts);
    } finally { signer.mockRestore(); }
  });
  test("cancelled assignment is denied", async () => {
    const seed = await fixture(), result = await create(seed);
    await transition(db.client, result.assignment.id, 0n, "CANCELLED");
    await expect(access().withAuthorizedAssignment(await context(seed.expert.id), result.assignment.id, jest.fn())).rejects.toMatchObject({ status: 403 });
  });
  test("deleted video is denied without waiting for C051", async () => {
    const seed = await fixture(), result = await create(seed);
    await db.client.video.update({ where: { id: seed.video.id }, data: { deletedAt: new Date() } });
    await expect(access().withAuthorizedAssignment(await context(seed.expert.id), result.assignment.id, jest.fn())).rejects.toMatchObject({ status: 403 });
  });
  test.each([false, true])("bilateral block is denied (reverse=%s)", async reverse => {
    const seed = await fixture(), result = await create(seed);
    await db.client.block.create({ data: { blockerId: reverse ? seed.expert.id : seed.owner.id, blockedId: reverse ? seed.owner.id : seed.expert.id } });
    await expect(access().withAuthorizedAssignment(await context(seed.expert.id), result.assignment.id, jest.fn())).rejects.toMatchObject({ status: 403 });
  });
  test("session expiry during evidence I/O is rechecked with the database clock", async () => {
    const seed = await fixture(), result = await create(seed), auth = await context(seed.expert.id);
    const [clock] = await db.client.$queryRaw<{ at: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC' + interval '2 seconds')::timestamp(3) AS at`;
    await db.client.session.update({ where: { id: auth.sessionId }, data: { expiresAt: clock.at } });
    const source = app.get(ExpertEvidenceSource), original = source.find.bind(source);
    jest.spyOn(source, "find").mockImplementationOnce(async id => {
      await db.client.$transaction(tx => waitForDeadline(tx, clock.at), { timeout: 7000 });
      return original(id);
    });
    const action = jest.fn();
    await expect(access().withAuthorizedAssignment(auth, result.assignment.id, action)).rejects.toMatchObject({ status: 401 });
    expect(action).not.toHaveBeenCalled();
  });
  test.each(["UTC", "Asia/Ho_Chi_Minh"])("deadline wait stays bounded and HTTP remains 401 in %s", async timezone => {
    const seed = await fixture(), result = await create(seed), auth = await context(seed.expert.id);
    const url = new URL(db.url);
    // One physical connection makes the post-transaction restoration assertion meaningful.
    url.searchParams.set("connection_limit", "1");
    const waitingClient = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const settings = () => waitingClient.$queryRaw<{ timezone: string; timeout: string; pid: number }[]>`
      SELECT current_setting('TimeZone') AS timezone,
        current_setting('statement_timeout') AS timeout, pg_backend_pid() AS pid`;
    const before = await settings();
    const source = app.get(ExpertEvidenceSource), original = source.find.bind(source);
    const signer = jest.spyOn(app.get(PrivateStorageService), "playbackGrant");
    let waited = false;
    try {
      const [clock] = await db.client.$queryRaw<{ at: Date }[]>`SELECT
        (clock_timestamp() AT TIME ZONE 'UTC' + interval '2 seconds')::timestamp(3) AS at`;
      await db.client.session.update({ where: { id: auth.sessionId }, data: { expiresAt: clock.at } });
      jest.spyOn(source, "find").mockImplementationOnce(async id => {
        await waitingClient.$transaction(async tx => {
          await tx.$queryRaw`SELECT set_config('TimeZone', ${timezone}, true)`;
          const [zone] = await tx.$queryRaw<{ timezone: string; seconds: number }[]>`SELECT
            current_setting('TimeZone') AS timezone,
            EXTRACT(EPOCH FROM ((${clock.at}::timestamptz AT TIME ZONE 'UTC') -
              (clock_timestamp() AT TIME ZONE 'UTC')))::double precision AS seconds`;
          expect(zone.timezone).toBe(timezone);
          expect(zone.seconds).toBeGreaterThan(0);
          expect(zone.seconds).toBeLessThanOrEqual(2);
          await waitForDeadline(tx, clock.at);
          const [after] = await tx.$queryRaw<{ elapsed: boolean; timeout: string }[]>`SELECT
            (clock_timestamp() AT TIME ZONE 'UTC') >=
              (${clock.at}::timestamptz AT TIME ZONE 'UTC') AS elapsed,
            current_setting('statement_timeout') AS timeout`;
          expect(after).toEqual({ elapsed: true, timeout: "5s" });
          waited = true;
        }, { timeout: 7000 });
        return original(id);
      });
      const response = await playback(seed.expert.cookie, result.assignment.id);
      expect(response.status).toBe(401);
      expect(waited).toBe(true);
      expect(signer).not.toHaveBeenCalled();
      expect(await db.client.auditLog.count({ where: {
        action: "EXPERT_PLAYBACK_ISSUED", subjectId: result.assignment.id,
      } })).toBe(0);
    } finally {
      try { expect(await settings()).toEqual(before); }
      finally { await waitingClient.$disconnect(); }
    }
  });
  test("default MFA source fails closed", async () => {
    const seed = await fixture(), result = await create(seed), action = jest.fn();
    await expect(access(new ExpertMfaSource()).withAuthorizedAssignment(await context(seed.expert.id), result.assignment.id, action)).rejects.toMatchObject({ status: 403 });
    expect(action).not.toHaveBeenCalled();
  });
  test("protected callback failure rolls back its writes", async () => {
    const seed = await fixture(), result = await create(seed);
    await expect(access().withAuthorizedAssignment(await context(seed.expert.id), result.assignment.id, async tx => {
      await tx.auditLog.create({ data: { actorId: seed.expert.id, action: "SYNTHETIC_C034_ROLLBACK", subjectType: "ExpertAssignment", subjectId: result.assignment.id } });
      throw new Error("synthetic failure");
    })).rejects.toMatchObject({ status: 503 });
    expect(await db.client.auditLog.count({ where: { action: "SYNTHETIC_C034_ROLLBACK", subjectId: result.assignment.id } })).toBe(0);
  });
});
