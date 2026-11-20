import { StaffAssuranceSource } from "../src/safety/staff-assurance.source";
import { HttpException, INestApplication, ServiceUnavailableException } from "@nestjs/common";
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
import type { AuthContext } from "../src/auth/auth-context";
import { AssignmentCancellationService } from "../src/assignment-cancellation/assignment-cancellation.service";
import { AssignmentGrantProvisioningSource } from "../src/expert-admin/assignment-grant-provisioning.source";
import { AssignmentGrantsService } from "../src/expert-admin/assignment-grants.service";
import { assignmentEvent } from "./expert-db-fixtures";

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
      .overrideProvider(AssignmentGrantProvisioningSource).useValue({ resolve: async (_tx: unknown, auth: AuthContext) => ({
        userId: auth.user.id, role: "ADMIN", active: true, reference: "synthetic-c035-c051-admin", testOnly: true }) })
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
  type Queue = { assignments: { id: string; status: string; dueAt: string | null }[]; nextCursor: string | null };
  async function queue(cookie: string, role: "EXPERT" | "MODERATOR", query = ""): Promise<Queue> {
    const response = await get(cookie, (role === "EXPERT" ? "expert/assignments/me" : "expert-admin/assignments") + query);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    const body = await response.json() as Queue;
    expect(body.assignments.every(row => Object.keys(row).sort().join() === "dueAt,id,status")).toBe(true);
    return body;
  }
  async function auth(actor: Awaited<ReturnType<typeof user>>): Promise<AuthContext> {
    const session = await db.client.session.findFirstOrThrow({ where: { userId: actor.id } });
    return { sessionId: session.id, user: { id: actor.id, email: actor.email, role: actor.role, displayName: actor.displayName } };
  }
  async function authorize(admin: AuthContext, assignmentId: string, moderatorId: string) {
    const [clock] = await db.client.$queryRaw<{ expires: Date }[]>`SELECT clock_timestamp() + interval '10 minutes' AS expires`;
    return app.get(AssignmentGrantsService).grant(admin, { assignmentId, moderatorId, expectedRevision: 0, expiresAt: clock.expires.toISOString() });
  }
  async function deleteVideo(seed: Awaited<ReturnType<typeof fixture>>) {
    const response = await fetch(`${base}/api/videos/${seed.video.id}`, { method: "DELETE",
      headers: { Cookie: seed.owner.cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await db.client.video.findUniqueOrThrow({ where: { id: seed.video.id } })).toMatchObject({ status: "DELETED" });
  }
  async function withdraw(seed: Awaited<ReturnType<typeof fixture>>, purpose: "VIDEO_STORAGE" | "EXPERT_VIDEO_REVIEW") {
    const response = await fetch(`${base}/api/consents/me`, { method: "PATCH", headers: { Cookie: seed.owner.cookie,
      Origin: origin, "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ expectedVersion: 1, consents: [{ purpose, granted: false }] }) });
    expect(response.status).toBe(200);
    const ledger = await db.client.consentLedger.findUniqueOrThrow({ where: { userId: seed.owner.id } });
    return db.client.consentWithdrawalTask.findFirstOrThrow({ where: { subjectId: ledger.subjectId, version: 2n, purpose } });
  }
  // Real HTTP cancellation/withdrawal and the real C051 consumer, not fixture status
  // updates. Synthetic policy/provisioning/MFA sources never enable production.
  test.each((["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] as const).flatMap(status =>
    (["delete", "VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"] as const).map(cause => ({ status, cause }))))(
    "C051 $cause from $status preserves authorized historical queue metadata", async ({ status, cause }) => {
      const seed = await fixture(), result = await create(seed), viewer = await user("MODERATOR"), outsider = await user("EXPERT");
      const admin = await auth(await user("ADMIN")), id = result.assignment.id;
      const grant = await authorize(admin, id, viewer.id);
      const grantEvidence = await db.client.assignmentModeratorGrantEvent.findUniqueOrThrow({ where: { id: grant.grantId } });
      let revision = 0n;
      if (status !== "ASSIGNED") await transition(db.client, id, revision++, "IN_PROGRESS");
      if (status === "SUBMITTED") await transition(db.client, id, revision++, "SUBMITTED");
      const before = { assignments: [{ id, status, dueAt: null }], nextCursor: null };
      expect(await queue(seed.expert.cookie, "EXPERT")).toEqual(before);
      expect(await queue(viewer.cookie, "MODERATOR")).toEqual(before);
      if (cause === "delete") await deleteVideo(seed);
      else {
        const task = await withdraw(seed, cause);
        // Current consent denies access before the asynchronous consumer changes
        // status; queue metadata itself is not a media access grant.
        await expect(db.client.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id=${seed.owner.id} FOR UPDATE`;
          return app.get(ConsentAccessService).requireInTransaction(tx, seed.owner.id, [cause]);
        })).rejects.toMatchObject({ status: 403, response: { code: "CONSENT_REQUIRED" } });
        expect(await queue(viewer.cookie, "MODERATOR")).toEqual(before);
        expect(await app.get(AssignmentCancellationService).processWithdrawal(task.id)).toMatchObject({ completed: true, cancelled: 1 });
        expect(await db.client.assignmentWithdrawalReceipt.findUnique({ where: { withdrawalTaskId: task.id } })).not.toBeNull();
        await patchConsent(seed.owner.id, 2, cause, true);
        expect(await app.get(AssignmentCancellationService).processWithdrawal(task.id)).toMatchObject({ completed: true, cancelled: 0 });
        await expect(db.client.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id=${seed.owner.id} FOR UPDATE`;
          return app.get(ConsentAccessService).requireGenerationInTransaction(tx, seed.owner.id, task.subjectId, 1n, cause);
        })).rejects.toMatchObject({ status: 403, response: { code: "CONSENT_GENERATION_WITHDRAWN" } });
      }
      const after = { assignments: [{ id, status: "CANCELLED", dueAt: null }], nextCursor: null };
      expect(await queue(seed.expert.cookie, "EXPERT")).toEqual(after);
      expect(await queue(viewer.cookie, "MODERATOR")).toEqual(after);
      expect(await queue(seed.expert.cookie, "EXPERT", `?status=${status}`)).toEqual({ assignments: [], nextCursor: null });
      expect(await queue(viewer.cookie, "MODERATOR", `?status=${status}`)).toEqual({ assignments: [], nextCursor: null });
      expect(await queue(seed.moderator.cookie, "MODERATOR")).toEqual({ assignments: [], nextCursor: null });
      expect(await queue(outsider.cookie, "EXPERT")).toEqual({ assignments: [], nextCursor: null });
      expect(await db.client.expertAssignment.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "CANCELLED", revision: revision + 1n });
      const event = await db.client.assignmentEvent.findFirstOrThrow({ where: { assignmentId: id, revision: revision + 1n }, include: { cancellation: true } });
      expect(await db.client.assignmentEvent.count({ where: { assignmentId: id } })).toBe(Number(revision) + 2);
      expect(event).toMatchObject({ fromStatus: status, toStatus: "CANCELLED", cancellation: { reason: cause === "delete" ? "VIDEO_DELETED" : `${cause}_WITHDRAWN` } });
      expect(await db.client.assignmentModeratorGrantEvent.findUniqueOrThrow({ where: { id: grant.grantId } })).toEqual(grantEvidence);
      expect(await db.client.assignmentModeratorScope.findUniqueOrThrow({ where: { id: grant.scopeId } })).toMatchObject({ revision: 1n, currentGrantId: grant.grantId });
      const playback = await fetch(`${base}/api/expert/assignments/${id}/playback`, { method: "POST",
        headers: { Cookie: viewer.cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}" });
      expect(playback.status).toBe(403);
      expect(await db.client.auditLog.count({ where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: id } })).toBe(0);
    });

  test("C051 cancellation batches preserve scoped pagination and do not revive a revoked next-page grant", async () => {
    const seed = await fixture(), foreign = await fixture(), viewer = await user("MODERATOR"), other = await user("MODERATOR");
    const admin = await auth(await user("ADMIN")), ledger = await db.client.consentLedger.findUniqueOrThrow({ where: { userId: seed.owner.id } });
    const approval = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: seed.expert.id } });
    const foreignApproval = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: foreign.expert.id } });
    const prefix = randomUUID().replaceAll("-", ""), allowed: string[] = [], hidden: string[] = [], grants = [];
    // Bulk initialization is a valid database fixture. Cancellation and queue reads
    // below use actual C051/PA2 services and HTTP, not fabricated terminal states.
    for (let index = 0; index < 54; index++) {
      const own = index < 51, id = `${own ? "queue" : "zz_hidden"}_${prefix}_${String(index).padStart(3, "0")}`;
      await db.client.$transaction(async tx => {
        const video = await tx.video.create({ data: { ownerId: seed.owner.id, bucket: "synthetic-private", objectKey: randomUUID(),
          mimeType: "video/mp4", status: "READY", storageConsentVersion: 1n } });
        await tx.expertAssignment.create({ data: { id, videoId: video.id, expertId: own ? seed.expert.id : foreign.expert.id,
          credentialApprovalId: own ? approval.approvalId : foreignApproval.approvalId, assignedById: seed.moderator.id,
          assignedByEvidence: { subject: "synthetic-creator" }, reviewConsentSubjectId: ledger.subjectId, reviewConsentVersion: 1n,
          dueAt: new Date("2090-01-01T00:00:00.000Z") } });
        await assignmentEvent(tx, id, null);
      });
      (own ? allowed : hidden).push(id);
      const result = await authorize(admin, id, own ? viewer.id : other.id);
      if (own) grants.push(result);
    }
    const task = await withdraw(seed, "EXPERT_VIDEO_REVIEW"), consumer = app.get(AssignmentCancellationService);
    for (const [index, count] of [20, 20, 14].entries()) {
      expect(await consumer.processWithdrawal(task.id)).toMatchObject({ cancelled: count, completed: index === 2 });
      expect(await db.client.assignmentWithdrawalReceipt.count({ where: { withdrawalTaskId: task.id } })).toBe(index === 2 ? 1 : 0);
    }
    const first = await queue(viewer.cookie, "MODERATOR", "?status=CANCELLED");
    expect(first.assignments.map(row => row.id)).toEqual([...allowed].reverse().slice(0, 50));
    expect(first.assignments.every(row => row.dueAt === "2090-01-01T00:00:00.000Z")).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    const query = "?status=CANCELLED&cursor=" + encodeURIComponent(first.nextCursor!);
    expect((await queue(viewer.cookie, "MODERATOR", query)).assignments.map(row => row.id)).toEqual([allowed[0]]);
    const expertFirst = await queue(seed.expert.cookie, "EXPERT", "?status=CANCELLED");
    expect(expertFirst.assignments).toEqual(first.assignments);
    expect((await queue(seed.expert.cookie, "EXPERT", "?status=CANCELLED&cursor=" + encodeURIComponent(expertFirst.nextCursor!))).assignments.map(row => row.id)).toEqual([allowed[0]]);
    expect((await queue(other.cookie, "MODERATOR", "?status=CANCELLED")).assignments.map(row => row.id)).toEqual([...hidden].reverse());
    expect(await queue(seed.moderator.cookie, "MODERATOR")).toEqual({ assignments: [], nextCursor: null });
    const terminalEvents = await db.client.assignmentEvent.findMany({ where: { assignmentId: { in: [...allowed, ...hidden] } }, orderBy: { id: "asc" } });
    await app.get(AssignmentGrantsService).revoke(admin, { scopeId: grants[0].scopeId, grantId: grants[0].grantId, expectedRevision: 1 });
    expect(await queue(viewer.cookie, "MODERATOR", query)).toEqual({ assignments: [], nextCursor: null });
    expect(await consumer.processWithdrawal(task.id)).toMatchObject({ completed: true, cancelled: 0 });
    expect(await queue(viewer.cookie, "MODERATOR", query)).toEqual({ assignments: [], nextCursor: null });
    expect(await db.client.assignmentEvent.findMany({ where: { assignmentId: { in: [...allowed, ...hidden] } }, orderBy: { id: "asc" } })).toEqual(terminalEvents);
  }, 90000);

  test.each(["read-first", "revoke-first"] as const)("C051 cancelled metadata serializes %s without restoring revoked scope", async order => {
    const seed = await fixture(), result = await create(seed), viewer = await user("MODERATOR"), admin = await auth(await user("ADMIN"));
    const service = app.get(AssignmentGrantsService), g = await authorize(admin, result.assignment.id, viewer.id);
    await deleteVideo(seed);
    const history = await db.client.assignmentEvent.findMany({ where: { assignmentId: result.assignment.id }, orderBy: { revision: "asc" } });
    const source = app.get(StaffAssuranceSource), original = source.resolve.bind(source);
    let entered!: () => void, release!: () => void, pid = 0, held = false;
    const ready = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    const proof = jest.spyOn(source, "resolve").mockImplementation(async (tx, current) => {
      if (!held && current.user.id === (order === "read-first" ? viewer.id : admin.user.id)) {
        held = true; const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pid = backend.pid; entered(); await barrier;
      }
      return original(tx, current);
    });
    const read = () => get(viewer.cookie, "expert-admin/assignments?status=CANCELLED");
    const revoke = () => service.revoke(admin, { scopeId: g.scopeId, grantId: g.grantId, expectedRevision: 1 });
    const first = order === "read-first" ? read() : revoke(), observed = first.then(value => ({ value }), error => ({ error }));
    let second: Promise<{ value?: unknown; error?: unknown }> | undefined;
    try {
      await Promise.race([ready, first]);
      second = (order === "read-first" ? revoke() : read()).then(value => ({ value }), error => ({ error }));
      let contended = false;
      for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
        const rows = await db.client.$queryRaw<{ pid: number }[]>`SELECT a.pid FROM pg_stat_activity a
          WHERE a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND position('FROM "User"' IN a.query)>0
            AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='"User"'::regclass)`;
        if (rows.length) { contended = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(contended).toBe(true); release();
      const a = await observed, b = await second;
      expect(a).toHaveProperty("value"); expect(b).toHaveProperty("value");
      if (!("value" in a)) throw a.error;
      const response = (order === "read-first" ? a.value : b.value) as Response;
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ assignments: order === "read-first" ? [{ id: result.assignment.id, status: "CANCELLED", dueAt: null }] : [], nextCursor: null });
      expect(order === "read-first" ? b.value : a.value).toMatchObject({ kind: "REVOKED", revision: 2 });
      expect(await queue(viewer.cookie, "MODERATOR")).toEqual({ assignments: [], nextCursor: null });
      await expect(service.grant(admin, { assignmentId: result.assignment.id, moderatorId: viewer.id, expectedRevision: 0,
        expiresAt: new Date(Date.now() + 600000).toISOString() })).rejects.toMatchObject({ status: 409 });
      expect(await db.client.assignmentModeratorScope.findUniqueOrThrow({ where: { id: g.scopeId } })).toMatchObject({ revision: 2n, currentGrantId: null });
      expect(await db.client.assignmentModeratorGrantEvent.count({ where: { scopeId: g.scopeId } })).toBe(2);
      expect(await db.client.assignmentEvent.findMany({ where: { assignmentId: result.assignment.id }, orderBy: { revision: "asc" } })).toEqual(history);
      expect((await queue(seed.expert.cookie, "EXPERT")).assignments).toEqual([{ id: result.assignment.id, status: "CANCELLED", dueAt: null }]);
    } finally { release(); await Promise.allSettled([first, ...(second ? [second] : [])]); proof.mockRestore(); }
  });
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
  test.each(["EXPERT", "MODERATOR"] as const)("sanitizes thrown %s MFA provider errors without changing application denials", async role => {
    const seed = await fixture();
    const cookie = role === "EXPERT" ? seed.expert.cookie : seed.moderator.cookie;
    const path = role === "EXPERT" ? "expert/assignments/me" : "expert-admin/assignments";
    jest.spyOn(app.get(StaffAssuranceSource), "resolve").mockRejectedValue(
      new ServiceUnavailableException({ message: "synthetic private MFA response", token: "synthetic-mfa-secret" }),
    );
    const response = await get(cookie, path);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ code: "ASSIGNMENT_ASSURANCE_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toMatch(/synthetic private MFA response|synthetic-mfa-secret/);
    expect(await db.client.auditLog.count({ where: { actorId: role === "EXPERT" ? seed.expert.id : seed.moderator.id,
      action: "ASSIGNMENT_QUEUE_READ" } })).toBe(0);
    // Role/session failures originate in the application, outside the provider boundary.
    expect((await get(seed.owner.cookie, path)).status).toBe(403);
  });
  test("candidate evidence/source outage fails closed without exposing details", async () => {
    const seed = await fixture();
    jest.spyOn(app.get(ExpertEvidenceSource), "find").mockResolvedValue(undefined);
    const response = await get(seed.moderator.cookie, candidatePath(seed));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(seed.trainingEvidenceId);
  });
  test.each(["registry", "evidence"] as const)("sanitizes private %s provider exceptions", async provider => {
    const seed = await fixture();
    if (provider === "registry") {
      jest.spyOn(app.get(ExpertApprovalRegistry), "training").mockImplementation(() => {
        throw new ServiceUnavailableException({ message: "synthetic private registry response", reference: "registry-secret" });
      });
    } else {
      jest.spyOn(app.get(ExpertEvidenceSource), "find").mockRejectedValue(
        new HttpException({ message: "synthetic private evidence response", objectKey: "private-object-key" }, 403),
      );
    }
    const response = await get(seed.moderator.cookie, candidatePath(seed));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ code: "ASSIGNMENT_EVIDENCE_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toMatch(/synthetic private|registry-secret|private-object-key/);
    expect(await db.client.auditLog.count({ where: { actorId: seed.moderator.id,
      action: { in: ["ASSIGNMENT_QUEUE_READ", "ASSIGNMENT_CANDIDATE_READ"] } } })).toBe(0);
  });
  test("missing scope membership exposes neither own creations nor another moderator's assignments", async () => {
    const own = await fixture(), other = await fixture();
    const first = await create(own), second = await create(other);
    expect(await db.client.expertAssignment.count({ where: { id: { in: [first.assignment.id, second.assignment.id] } } })).toBe(2);
    const scopesBefore = await db.client.assignmentModeratorScope.count();
      const response = await get(own.moderator.cookie, "expert-admin/assignments?status=ASSIGNED");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json() as Record<string, unknown>;
      expect(body).toEqual({ assignments: [], nextCursor: null });
      expect(JSON.stringify(body)).not.toContain(first.assignment.id);
      expect(JSON.stringify(body)).not.toContain(second.assignment.id);
      expect(await db.client.assignmentModeratorScope.count({ where: { assignmentId: { in: [first.assignment.id, second.assignment.id] } } })).toBe(0);
      expect(await db.client.assignmentModeratorScope.count()).toBe(scopesBefore);
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
