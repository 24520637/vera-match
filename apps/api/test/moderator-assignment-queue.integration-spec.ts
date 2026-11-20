import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, UserRole } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import type { AuthContext } from "../src/auth/auth-context";
import { hashSessionToken } from "../src/auth/session-token";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { configureApplication } from "../src/configure-app";
import { PrismaService } from "../src/database/prisma.service";
import { AssignmentGrantProvisioningSource } from "../src/expert-admin/assignment-grant-provisioning.source";
import { AssignmentGrantsService } from "../src/expert-admin/assignment-grants.service";
import { StaffAssuranceSource, StaffAssurance } from "../src/safety/staff-assurance.source";
import { nextCursor } from "../src/safety/safety.validation";
import { createAuthDatabase } from "./disposable-auth-database";
import { assign, assignmentEvent, seedExpert, transition } from "./expert-db-fixtures";

/** Real HTTP/SQL and Stage 2 mutations. All accounts, media metadata, provisioning
 * and MFA proofs are synthetic and isolated; no production/C051 acceptance.
 */
describe("C035 PA2 moderator assignment queue", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>, app: INestApplication, base: string, grants: AssignmentGrantsService;
  let assurance: (tx: Prisma.TransactionClient, auth: AuthContext) => Promise<StaffAssurance | undefined>;
  const origin = "http://localhost:3000";
  beforeAll(async () => { db = await createAuthDatabase(); }, 60000);
  beforeEach(async () => {
    assurance = async (_tx, auth) => ({ userId: auth.user.id, sessionId: auth.sessionId, level: "MFA", verifiedAt: new Date(0),
      expiresAt: new Date(Date.now() + 600000), testOnly: true });
    const values = parseEnvironment({ ...process.env, NODE_ENV: "test", DATABASE_URL: db.url,
      MINIO_ROOT_USER: "synthetic-test", MINIO_ROOT_PASSWORD: "synthetic-test-only", CORS_ORIGIN: origin });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(db.client)
      .overrideProvider(EnvironmentService).useValue({ values })
      .overrideProvider(AssignmentGrantProvisioningSource).useValue({ resolve: async (_tx: unknown, auth: AuthContext) => ({
        userId: auth.user.id, role: "ADMIN", active: true, reference: "synthetic-admin-provisioning", testOnly: true }) })
      .overrideProvider(StaffAssuranceSource).useValue({ resolve: (tx: Prisma.TransactionClient, auth: AuthContext) => assurance(tx, auth) }).compile();
    app = module.createNestApplication({ logger: false }); configureApplication(app);
    await app.listen(0, "127.0.0.1"); base = await app.getUrl(); grants = app.get(AssignmentGrantsService);
  });
  afterEach(async () => { await app?.close(); });
  afterAll(async () => { await db?.close(); });
  async function session(userId: string) {
    const row = await db.client.user.update({ where: { id: userId }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });
    const token = randomBytes(32).toString("base64url"), record = await db.client.session.create({ data: {
      userId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 600000) } });
    const auth: AuthContext = { sessionId: record.id, user: { id: row.id, email: row.email, role: row.role, displayName: row.displayName } };
    return { auth, record, cookie: `${app.get(EnvironmentService).values.session.cookieName}=${token}` };
  }
  async function user(role: UserRole) {
    const row = await db.client.user.create({ data: { role, email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-only" } });
    return session(row.id);
  }
  async function future(milliseconds = 600000) {
    const [clock] = await db.client.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() + ${milliseconds} * interval '1 millisecond' AS at`;
    return clock.at;
  }
  async function pass(deadline: Date) {
    await db.client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '4s'");
      await tx.$queryRaw`SELECT true AS elapsed FROM pg_sleep(GREATEST(0,
        EXTRACT(EPOCH FROM (${deadline}::timestamptz - clock_timestamp())))::double precision + 0.05)`;
    }, { timeout: 6000 });
  }
  async function fixture() {
    const seed = await seedExpert(db.client), assignment = await assign(db.client, seed);
    return { seed, assignment, moderator: await session(seed.moderator.id), admin: await user("ADMIN") };
  }
  async function grant(f: Awaited<ReturnType<typeof fixture>>, assignmentId = f.assignment.id, moderatorId = f.moderator.auth.user.id,
    expectedRevision = 0, expiresAt?: Date) {
    return grants.grant(f.admin.auth, { assignmentId, moderatorId, expectedRevision, expiresAt: (expiresAt ?? await future()).toISOString() });
  }
  const revoke = (f: Awaited<ReturnType<typeof fixture>>, g: { scopeId: string; grantId: string; revision: number }) =>
    grants.revoke(f.admin.auth, { scopeId: g.scopeId, grantId: g.grantId, expectedRevision: g.revision });
  const get = (cookie: string, query = "", headers: Record<string, string> = {}) =>
    fetch(`${base}/api/expert-admin/assignments${query}`, { headers: { Cookie: cookie, Origin: origin, ...headers } });
  const readCount = (id: string) => db.client.auditLog.count({ where: { actorId: id, action: "ASSIGNMENT_QUEUE_READ" } });
  async function page(cookie: string, query = "") {
    const response = await get(cookie, query); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    return await response.json() as { assignments: { id: string; status: string; dueAt: string | null }[]; nextCursor: string | null };
  }
  function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
  async function observe(pid: number, kind: "lock" | "audit") {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const rows = kind === "lock" ? await db.client.$queryRaw<{ pid: number }[]>`SELECT a.pid FROM pg_stat_activity a
        WHERE a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND position('FROM "User"' IN a.query)>0
          AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='"User"'::regclass)` :
        await db.client.$queryRaw<{ pid: number }[]>`SELECT a.pid FROM pg_stat_activity a
          WHERE a.wait_event='PgSleep' AND position('AuditLog' IN a.query)>0
            AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='"AuditLog"'::regclass)`;
      if (rows.length) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Expected PostgreSQL ${kind} phase was not observed`);
  }
  it("returns an empty audited queue without creating scope/identity, including the creator", async () => {
    const f = await fixture();
    expect(await page(f.moderator.cookie)).toEqual({ assignments: [], nextCursor: null });
    expect(await db.client.expertActorIdentity.findUnique({ where: { userId: f.moderator.auth.user.id } })).toBeNull();
    expect(await db.client.assignmentModeratorScope.count({ where: { assignmentId: f.assignment.id } })).toBe(0);
    expect(await readCount(f.moderator.auth.user.id)).toBe(1);
  });
  it("only returns explicitly granted safe metadata, never creator or another moderator's scope", async () => {
    const f = await fixture(), other = await fixture(), viewer = await user("MODERATOR");
    await grant(f, other.assignment.id, viewer.auth.user.id);
    await grant(f); // Creator access is explicit, not inherited from assignedById.
    const events = await db.client.assignmentModeratorGrantEvent.findMany({ orderBy: { id: "asc" } });
    expect(await page(viewer.cookie)).toEqual({ assignments: [{ id: other.assignment.id, status: "ASSIGNED", dueAt: null }], nextCursor: null });
    expect(await page(other.moderator.cookie)).toEqual({ assignments: [], nextCursor: null });
    expect(await page(f.moderator.cookie)).toEqual({ assignments: [{ id: f.assignment.id, status: "ASSIGNED", dueAt: null }], nextCursor: null });
    expect(await db.client.assignmentModeratorGrantEvent.findMany({ orderBy: { id: "asc" } })).toEqual(events);
    const audit = await db.client.auditLog.findFirstOrThrow({ where: { actorId: viewer.auth.user.id, action: "ASSIGNMENT_QUEUE_READ" } });
    expect(audit).toMatchObject({ subjectType: "AssignmentQueue", subjectId: null });
  });
  it("a metadata grant does not confer EXPERT playback capability", async () => {
    const f = await fixture(); await grant(f);
    expect((await page(f.moderator.cookie)).assignments).toHaveLength(1);
    const response = await fetch(`${base}/api/expert/assignments/${f.assignment.id}/playback`, { method: "POST",
      headers: { Cookie: f.moderator.cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(403);
    expect(await db.client.auditLog.count({ where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: f.assignment.id } })).toBe(0);
    expect(await db.client.expertAssignment.findUnique({ where: { id: f.assignment.id } })).toMatchObject({ status: "ASSIGNED", revision: 0n });
  });
  it("does not list a cascaded assignment even while its grant evidence is retained", async () => {
    const f = await fixture(), g = await grant(f);
    await db.client.video.delete({ where: { id: f.seed.video.id } });
    expect(await page(f.moderator.cookie)).toEqual({ assignments: [], nextCursor: null });
    expect(await db.client.assignmentModeratorGrantEvent.findUnique({ where: { id: g.grantId } })).not.toBeNull();
    expect(await db.client.assignmentModeratorScope.findUnique({ where: { id: g.scopeId } })).toMatchObject({ currentGrantId: g.grantId });
  });
  it("applies grant and status predicates before stable pagination and rechecks membership on every page", async () => {
    const f = await fixture(), other = await user("MODERATOR"), allowed: string[] = [];
    async function add(id: string, status: "ASSIGNED" | "CANCELLED") {
      await db.client.$transaction(async tx => {
        const video = await tx.video.create({ data: { ownerId: f.seed.expert.id, bucket: "synthetic-private", objectKey: randomUUID(), mimeType: "video/mp4" } });
        await tx.expertAssignment.create({ data: { id, videoId: video.id, expertId: f.seed.expert.id, assignedById: f.seed.moderator.id,
          assignedByEvidence: { subject: "synthetic-creator" }, credentialApprovalId: f.seed.approval.id, dueAt: new Date("2090-01-01T00:00:00Z") } });
        await assignmentEvent(tx, id, null);
      });
      if (status === "CANCELLED") await transition(db.client, id, 0n, status);
    }
    const prefix = randomUUID().replaceAll("-", ""), results = [];
    for (let i = 0; i < 51; i++) {
      const id = `pa2_${prefix}_${String(i).padStart(3, "0")}`; allowed.push(id);
      await add(id, "ASSIGNED"); results.push(await grant(f, id));
    }
    for (let i = 0; i < 3; i++) {
      const hidden = `zz_hidden_${prefix}_${i}`, filtered = `zz_cancelled_${prefix}_${i}`;
      await add(hidden, "ASSIGNED"); await grant(f, hidden, other.auth.user.id);
      await add(filtered, "CANCELLED"); await grant(f, filtered);
    }
    const first = await page(f.moderator.cookie, "?status=ASSIGNED");
    expect(first.assignments.map(r => r.id)).toEqual([...allowed].reverse().slice(0, 50));
    expect(first.assignments.every(r => Object.keys(r).sort().join() === "dueAt,id,status" && r.dueAt === "2090-01-01T00:00:00.000Z")).toBe(true);
    expect(first.nextCursor).toBe(nextCursor(allowed[1]));
    const second = await page(f.moderator.cookie, "?status=ASSIGNED&cursor=" + first.nextCursor);
    expect(second.assignments.map(r => r.id)).toEqual([allowed[0]]); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.assignments, ...second.assignments].map(r => r.id)).size).toBe(51);
    await revoke(f, results[0]);
    expect(await page(f.moderator.cookie, "?status=ASSIGNED&cursor=" + first.nextCursor)).toEqual({ assignments: [], nextCursor: null });
    const forged = await page(f.moderator.cookie, "?status=ASSIGNED&cursor=" + nextCursor(`zz_hidden_${prefix}_0`));
    expect(forged.assignments.every(r => allowed.includes(r.id) && r.id !== allowed[0])).toBe(true);
  }, 90000);
  it("removes revoked/expired grants and requires a new lifecycle for renewed access", async () => {
    const f = await fixture(), first = await grant(f);
    expect((await page(f.moderator.cookie)).assignments).toHaveLength(1);
    await revoke(f, first); expect((await page(f.moderator.cookie)).assignments).toHaveLength(0);
    const deadline = await future(1500), second = await grant(f, f.assignment.id, f.moderator.auth.user.id, 2, deadline);
    expect(second.grantId).not.toBe(first.grantId);
    expect((await page(f.moderator.cookie)).assignments).toHaveLength(1);
    await pass(deadline); expect(await page(f.moderator.cookie)).toEqual({ assignments: [], nextCursor: null });
    const third = await grant(f, f.assignment.id, f.moderator.auth.user.id, 3);
    expect(third.grantId).not.toBe(second.grantId);
    expect((await page(f.moderator.cookie)).assignments).toHaveLength(1);
    expect(await db.client.assignmentModeratorGrantEvent.count({ where: { scopeId: first.scopeId } })).toBe(4);
  });
  it.each(["ADMIN", "MEMBER", "EXPERT"] as const)("denies %s without implicit MODERATOR permission", async role => {
    const actor = await user(role), response = await get(actor.cookie);
    expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await readCount(actor.auth.user.id)).toBe(0);
  });
  it.each(["missing", "expired", "revoked", "unverified", "suspended"])("denies %s session/account", async state => {
    const f = await fixture(); await grant(f);
    if (state === "expired") await db.client.session.update({ where: { id: f.moderator.record.id }, data: { expiresAt: new Date(0) } });
    if (state === "revoked") await db.client.session.update({ where: { id: f.moderator.record.id }, data: { revokedAt: new Date() } });
    if (state === "unverified") await db.client.user.update({ where: { id: f.moderator.auth.user.id }, data: { emailVerifiedAt: null } });
    if (state === "suspended") await db.client.user.update({ where: { id: f.moderator.auth.user.id }, data: { status: "SUSPENDED" } });
    expect((await get(state === "missing" ? "" : f.moderator.cookie)).status).toBe(401);
    expect(await readCount(f.moderator.auth.user.id)).toBe(0);
  });
  it.each(["missing", "outage"])("returns sanitized 503 for %s assurance, not a successful empty queue", async state => {
    const f = await fixture(); await grant(f);
    assurance = async () => { if (state === "outage") throw new ServiceUnavailableException("synthetic private provider detail"); return undefined; };
    const response = await get(f.moderator.cookie); expect(response.status).toBe(503);
    const body = await response.json(); expect(body).toMatchObject({ code: "ASSIGNMENT_ASSURANCE_UNAVAILABLE" });
    expect(body).not.toHaveProperty("assignments"); expect(JSON.stringify(body)).not.toMatch(/synthetic private|objectKey|grantId/);
    expect(await readCount(f.moderator.auth.user.id)).toBe(0);
  });
  it.each(["wrong-user", "wrong-session", "expired", "future"])("denies %s MFA without reading metadata", async state => {
    const f = await fixture(); await grant(f); const original = assurance;
    assurance = async (tx, auth) => ({ ...(await original(tx, auth))!, ...(state === "wrong-user" ? { userId: "another" } :
      state === "wrong-session" ? { sessionId: "another" } : state === "expired" ? { expiresAt: new Date(0) } : { verifiedAt: new Date("2099-01-01") }) });
    const response = await get(f.moderator.cookie); expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("assignments"); expect(await readCount(f.moderator.auth.user.id)).toBe(0);
  });
  it("does not expose synthetic grants in production even with real-looking MFA", async () => {
    const f = await fixture(); await grant(f); Object.assign(app.get(EnvironmentService).values, { nodeEnv: "production" });
    expect((await get(f.moderator.cookie)).status).toBe(403);
    const original = assurance; assurance = async (tx, auth) => ({ ...(await original(tx, auth))!, testOnly: false });
    const response = await get(f.moderator.cookie); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "MODERATOR_QUEUE_PROVISIONING_UNAVAILABLE" });
    assurance = (tx, auth) => new StaffAssuranceSource().resolve(tx, auth);
    expect((await get(f.moderator.cookie)).status).toBe(503); expect(await readCount(f.moderator.auth.user.id)).toBe(0);
  });
  it.each(["scopeId=forged", "moderatorId=another", "assignedById=another", "grantId=forged", "wildcard=true", "scope=*"])("rejects client scope claim %s", async query => {
    const f = await fixture(), response = await get(f.moderator.cookie, "?" + query);
    expect(response.status).toBe(400); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await readCount(f.moderator.auth.user.id)).toBe(0);
  });
  it("ignores forged scope headers and rejects an unavailable transaction without returning rows", async () => {
    const f = await fixture();
    expect(await (await get(f.moderator.cookie, "", { "X-Moderator-Scope": "*", "X-Assignment-Id": f.assignment.id })).json()).toEqual({ assignments: [], nextCursor: null });
    await grant(f); const before = await readCount(f.moderator.auth.user.id);
    const spy = jest.spyOn(db.client, "$transaction").mockRejectedValueOnce(new Error("synthetic private SQL detail"));
    try {
      const response = await get(f.moderator.cookie); expect(response.status).toBe(503);
      const body = await response.json(); expect(body).toMatchObject({ code: "ASSIGNMENT_QUEUE_UNAVAILABLE" });
      expect(JSON.stringify(body)).not.toContain("synthetic private"); expect(body).not.toHaveProperty("assignments");
      expect(await readCount(f.moderator.auth.user.id)).toBe(before);
    } finally { spy.mockRestore(); }
  });
  it("rolls back failed queue audit without exposing authorized metadata", async () => {
    const f = await fixture(); await grant(f);
    await db.client.$executeRawUnsafe("CREATE FUNCTION c035_queue_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private audit detail'; END $$");
    await db.client.$executeRawUnsafe('CREATE TRIGGER c035_queue_audit_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION c035_queue_audit_fail()');
    try {
      const response = await get(f.moderator.cookie); expect(response.status).toBe(503);
      const body = await response.json(); expect(body).not.toHaveProperty("assignments");
      expect(JSON.stringify(body)).not.toMatch(/synthetic private|grantId|objectKey/);
      expect(await readCount(f.moderator.auth.user.id)).toBe(0);
    } finally {
      await db.client.$executeRawUnsafe('DROP TRIGGER c035_queue_audit_fail ON "AuditLog"');
      await db.client.$executeRawUnsafe('DROP FUNCTION c035_queue_audit_fail()');
    }
  });
  it.each(["grant", "mfa"] as const)("%s expiry during an observed audit returns no rows and rolls the audit back", async bound => {
    const f = await fixture(); const deadline = await future(1500);
    await grant(f, f.assignment.id, f.moderator.auth.user.id, 0, bound === "grant" ? deadline : undefined);
    if (bound === "mfa") { const original = assurance; assurance = async (tx, auth) => ({ ...(await original(tx, auth))!, expiresAt: deadline }); }
    await db.client.$executeRawUnsafe("CREATE FUNCTION c035_queue_slow_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.6); RETURN NEW; END $$");
    await db.client.$executeRawUnsafe('CREATE TRIGGER c035_queue_slow_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION c035_queue_slow_audit()');
    const request = get(f.moderator.cookie);
    try {
      await observe(0, "audit");
      const response = await request; expect(response.status).toBe(bound === "grant" ? 503 : 403);
      expect(await response.json()).not.toHaveProperty("assignments"); expect(await readCount(f.moderator.auth.user.id)).toBe(0);
    } finally {
      await request;
      await db.client.$executeRawUnsafe('DROP TRIGGER c035_queue_slow_audit ON "AuditLog"');
      await db.client.$executeRawUnsafe('DROP FUNCTION c035_queue_slow_audit()');
    }
  });
  it.each(["read-first", "revoke-first"] as const)("serializes %s using real Stage 2 revoke and observed PostgreSQL contention", async order => {
    const f = await fixture(), g = await grant(f), entered = gate(), finish = gate(), original = assurance;
    let held = false, pid = 0;
    const heldUser = order === "read-first" ? f.moderator.auth.user.id : f.admin.auth.user.id;
    assurance = async (tx, auth) => {
      if (!held && auth.user.id === heldUser) {
        held = true; const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pid = backend.pid; entered.release(); await finish.promise;
      }
      return original(tx, auth);
    };
    const first = order === "read-first" ? get(f.moderator.cookie) : revoke(f, g);
    const observed = first.then(value => ({ value }), error => ({ error }));
    let second: Promise<unknown> | undefined;
    try {
      await Promise.race([entered.promise, first]);
      second = (order === "read-first" ? revoke(f, g) : get(f.moderator.cookie)).then(value => ({ value }), error => ({ error }));
      await observe(pid, "lock"); finish.release();
      const firstResult = await observed, secondResult = await second as { value?: unknown };
      expect(firstResult).toHaveProperty("value"); expect(secondResult).toHaveProperty("value");
      if (!("value" in firstResult)) throw firstResult.error;
      const read = (order === "read-first" ? firstResult.value : secondResult.value) as Response;
      const revoked = (order === "read-first" ? secondResult.value : firstResult.value) as { kind: string; revision: number };
      expect(revoked).toMatchObject({ kind: "REVOKED", revision: 2 }); expect(read.status).toBe(200);
      const body = await read.json() as { assignments: { id: string }[] };
      expect(body.assignments.map(r => r.id)).toEqual(order === "read-first" ? [f.assignment.id] : []);
      expect(await page(f.moderator.cookie)).toEqual({ assignments: [], nextCursor: null });
      expect(await db.client.assignmentModeratorGrantEvent.count({ where: { scopeId: g.scopeId } })).toBe(2);
      expect(await db.client.expertAssignment.findUnique({ where: { id: f.assignment.id } })).toMatchObject({ revision: 0n, status: "ASSIGNED" });
    } finally { finish.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
  });
  it.each(["session", "mfa", "grant"] as const)("rechecks %s expiry after a proven moderator lock wait", async bound => {
    const f = await fixture(), deadline = await future(1500);
    await grant(f, f.assignment.id, f.moderator.auth.user.id, 0, bound === "grant" ? deadline : undefined);
    if (bound === "session") await db.client.session.update({ where: { id: f.moderator.record.id }, data: { expiresAt: deadline } });
    if (bound === "mfa") { const original = assurance; assurance = async (tx, auth) => ({ ...(await original(tx, auth))!, expiresAt: deadline }); }
    const entered = gate(), finish = gate(); let pid = 0;
    const blocker = db.client.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.moderator.auth.user.id} FOR UPDATE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pid = backend.pid; entered.release(); await finish.promise;
    }, { timeout: 10000 });
    let request: Promise<Response> | undefined;
    try {
      await Promise.race([entered.promise, blocker]); request = get(f.moderator.cookie);
      await observe(pid, "lock"); await pass(deadline); finish.release(); await blocker;
      const response = await request; expect(response.status).toBe(bound === "session" ? 401 : bound === "mfa" ? 403 : 200);
      const body = await response.json();
      if (bound === "grant") expect(body).toEqual({ assignments: [], nextCursor: null }); else expect(body).not.toHaveProperty("assignments");
      expect(await readCount(f.moderator.auth.user.id)).toBe(bound === "grant" ? 1 : 0);
    } finally { finish.release(); await Promise.allSettled([blocker, ...(request ? [request] : [])]); }
  });
  it("cannot inherit a retained scope after moderator account deletion/recreation", async () => {
    const f = await fixture(); await grant(f);
    const oldId = f.moderator.auth.user.id;
    await db.client.user.delete({ where: { id: oldId } });
    await db.client.user.create({ data: { id: oldId, email: `${randomUUID()}@example.invalid`, role: "MODERATOR", passwordHash: "synthetic-only" } });
    const recreated = await session(oldId);
    expect(await page(recreated.cookie)).toEqual({ assignments: [], nextCursor: null });
    expect(await db.client.expertActorIdentity.findUnique({ where: { userId: oldId } })).toBeNull();
  });
});
