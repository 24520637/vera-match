import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import type { AuthContext } from "../src/auth/auth-context";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { PrismaService } from "../src/database/prisma.service";
import { AssignmentGrantProvisioningSource, AssignmentGrantAdminProvisioning } from "../src/expert-admin/assignment-grant-provisioning.source";
import { AssignmentGrantsService } from "../src/expert-admin/assignment-grants.service";
import { StaffAssuranceSource, StaffAssurance } from "../src/safety/staff-assurance.source";
import { createAuthDatabase } from "./disposable-auth-database";
import { assign, seedExpert } from "./expert-db-fixtures";

/** Real PostgreSQL/internal service, synthetic providers ONLY. No HTTP contract,
 * real provisioning/MFA acceptance, scope-aware queue or C051 claim is made here.
 */
describe("C035 PA2 ADMIN grant/revoke service", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>, app: INestApplication, service: AssignmentGrantsService;
  let provisioning: (auth: AuthContext) => Promise<AssignmentGrantAdminProvisioning | undefined>;
  let mfa: (auth: AuthContext) => Promise<StaffAssurance | undefined>;
  beforeAll(async () => { db = await createAuthDatabase(); }, 60000);
  beforeEach(async () => {
    provisioning = async auth => ({ userId: auth.user.id, role: "ADMIN", active: true, reference: "synthetic-provisioning-only", testOnly: true });
    mfa = async auth => ({ userId: auth.user.id, sessionId: auth.sessionId, level: "MFA", verifiedAt: new Date(0),
      expiresAt: new Date(Date.now() + 600000), testOnly: true });
    const values = parseEnvironment({ ...process.env, NODE_ENV: "test", DATABASE_URL: db.url,
      MINIO_ROOT_USER: "synthetic-test", MINIO_ROOT_PASSWORD: "synthetic-test-only" });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(db.client)
      .overrideProvider(EnvironmentService).useValue({ values })
      .overrideProvider(AssignmentGrantProvisioningSource).useValue({ resolve: (_tx: unknown, auth: AuthContext) => provisioning(auth) })
      .overrideProvider(StaffAssuranceSource).useValue({ resolve: (_tx: unknown, auth: AuthContext) => mfa(auth) }).compile();
    app = module.createNestApplication({ logger: false }); await app.init();
    service = app.get(AssignmentGrantsService);
  });
  afterEach(async () => { await app?.close(); });
  afterAll(async () => { await db?.close(); });
  async function user(role: UserRole = "ADMIN") {
    const row = await db.client.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-only",
      role, status: "ACTIVE", emailVerifiedAt: new Date() } });
    const session = await db.client.session.create({ data: { userId: row.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 600000) } });
    const auth: AuthContext = { sessionId: session.id, user: { id: row.id, email: row.email, displayName: row.displayName, role } };
    return { row, session, auth };
  }
  async function future(milliseconds = 600000) {
    const [clock] = await db.client.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() + ${milliseconds} * interval '1 millisecond' AS at`;
    return clock.at;
  }
  async function fixture() {
    const seed = await seedExpert(db.client), assignment = await assign(db.client, seed), admin = await user();
    await db.client.user.update({ where: { id: seed.moderator.id }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });
    const input = { assignmentId: assignment.id, moderatorId: seed.moderator.id, expectedRevision: 0, expiresAt: (await future()).toISOString() };
    return { seed, assignment, admin, input };
  }
  const revokeBody = (result: { scopeId: string; grantId: string; revision: number }) => ({ scopeId: result.scopeId, grantId: result.grantId, expectedRevision: result.revision });
  async function count(assignmentId: string) {
    const scopes = await db.client.assignmentModeratorScope.findMany({ where: { assignmentId } });
    return {
      scopes,
      events: await db.client.assignmentModeratorGrantEvent.findMany({ where: { scopeId: { in: scopes.map(s => s.id) } }, orderBy: { revision: "asc" } }),
      audits: await db.client.auditLog.findMany({ where: { subjectId: { in: (await db.client.assignmentModeratorGrantEvent.findMany({ where: { scopeId: { in: scopes.map(s => s.id) } }, select: { grantId: true } })).map(e => e.grantId) } }, orderBy: { id: "asc" } }),
    };
  }
  it("grants/revokes/regrants with server-owned evidence, monotonic revision and atomic audit without assignment mutation", async () => {
    const f = await fixture(), before = await db.client.expertAssignment.findUnique({ where: { id: f.assignment.id } });
    const grant = await service.grant(f.admin.auth, f.input);
    expect(grant).toMatchObject({ revision: 1, kind: "GRANTED", expiresAt: f.input.expiresAt });
    const identity = await db.client.expertActorIdentity.findUniqueOrThrow({ where: { userId: f.admin.row.id } });
    const first = await db.client.assignmentModeratorGrantEvent.findUniqueOrThrow({ where: { id: grant.grantId } });
    expect(first.actorEvidence).toMatchObject({ subject: identity.subjectId, provisioningReference: "synthetic-provisioning-only" });
    expect((await count(f.assignment.id)).audits).toEqual([expect.objectContaining({ actorId: f.admin.row.id, action: "ASSIGNMENT_MODERATOR_GRANTED" })]);
    expect(await service.revoke(f.admin.auth, revokeBody(grant))).toMatchObject({ revision: 2, kind: "REVOKED", grantId: first.id });
    const next = await service.grant(f.admin.auth, { ...f.input, expectedRevision: 2 });
    expect(next.revision).toBe(3); expect(next.grantId).not.toBe(first.id);
    expect(await db.client.assignmentModeratorGrantEvent.findUnique({ where: { id: first.id } })).toEqual(first);
    await expect(service.revoke(f.admin.auth, { ...revokeBody(next), grantId: first.id })).rejects.toMatchObject({ status: 409 });
    const state = await count(f.assignment.id);
    expect(state.events.map(e => [e.kind, e.revision])).toEqual([["GRANTED", 1n], ["REVOKED", 2n], ["GRANTED", 3n]]);
    expect(state.audits).toHaveLength(3);
    expect(await db.client.expertAssignment.findUnique({ where: { id: f.assignment.id } })).toEqual(before);
    expect(await db.client.assignmentEvent.count({ where: { assignmentId: f.assignment.id } })).toBe(1);
  });
  it.each(["MEMBER", "EXPERT", "MODERATOR"] as const)("denies %s on both service methods", async role => {
    const f = await fixture(), caller = await user(role);
    await expect(service.grant(caller.auth, f.input)).rejects.toMatchObject({ status: 403 });
    await expect(service.revoke(caller.auth, { scopeId: randomUUID(), grantId: randomUUID(), expectedRevision: 1 })).rejects.toMatchObject({ status: 403 });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it("rejects missing server session context on both service methods", async () => {
    const f = await fixture();
    await expect(service.grant(undefined as unknown as AuthContext, f.input)).rejects.toMatchObject({ status: 401 });
    await expect(service.revoke(undefined as unknown as AuthContext, {})).rejects.toMatchObject({ status: 401 });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it("does not trust a forged ADMIN role in the caller context", async () => {
    const f = await fixture(), member = await user("MEMBER");
    await expect(service.grant({ ...member.auth, user: { ...member.auth.user, role: "ADMIN" } }, f.input)).rejects.toMatchObject({ status: 403 });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it.each(["suspended", "unverified", "expired", "revoked", "missing", "wrong-user"])("rejects %s ADMIN account/session", async state => {
    const f = await fixture(); let auth = f.admin.auth;
    if (state === "suspended") await db.client.user.update({ where: { id: f.admin.row.id }, data: { status: "SUSPENDED" } });
    if (state === "unverified") await db.client.user.update({ where: { id: f.admin.row.id }, data: { emailVerifiedAt: null } });
    if (state === "expired") await db.client.session.update({ where: { id: f.admin.session.id }, data: { expiresAt: new Date(0) } });
    if (state === "revoked") await db.client.session.update({ where: { id: f.admin.session.id }, data: { revokedAt: new Date() } });
    if (state === "missing") auth = { ...auth, sessionId: "missing" };
    if (state === "wrong-user") auth = { ...auth, sessionId: (await user()).session.id };
    await expect(service.grant(auth, f.input)).rejects.toMatchObject({ status: 401 });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it.each(["provisioning", "mfa"])("default missing %s denies both grant and revoke", async source => {
    const f = await fixture(), granted = await service.grant(f.admin.auth, f.input), before = await count(f.assignment.id);
    const closed = new AssignmentGrantsService(db.client as unknown as PrismaService, app.get(EnvironmentService),
      source === "provisioning" ? new AssignmentGrantProvisioningSource() : app.get(AssignmentGrantProvisioningSource),
      new StaffAssuranceSource());
    for (const action of [() => closed.grant(f.admin.auth, { ...f.input, expectedRevision: 1 }), () => closed.revoke(f.admin.auth, revokeBody(granted))])
      await expect(action()).rejects.toMatchObject({ status: 503, response: { code: source === "provisioning" ? "ASSIGNMENT_ADMIN_PROVISIONING_UNAVAILABLE" : "ASSIGNMENT_ADMIN_MFA_UNAVAILABLE" } });
    expect(await count(f.assignment.id)).toEqual(before);
  });
  it.each(["provisioning", "mfa"])("sanitizes even HTTP exceptions from the %s provider", async source => {
    const f = await fixture();
    // Even a synchronous throw before a provider can return its Promise is sanitized.
    const broken = () => { throw new ServiceUnavailableException({ message: "synthetic private provider detail", secret: "synthetic-private-reference" }); };
    if (source === "provisioning") provisioning = broken; else mfa = broken;
    const error = await service.grant(f.admin.auth, f.input).then(() => { throw new Error("Unexpected success"); }, failure => failure);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual({ code: source === "provisioning" ? "ASSIGNMENT_ADMIN_PROVISIONING_UNAVAILABLE" : "ASSIGNMENT_ADMIN_MFA_UNAVAILABLE",
      message: "Grant state could not be confirmed. Refresh before repeating the operation." });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it.each(["provisioning", "mfa"])("synthetic %s cannot authorize production", async source => {
    const f = await fixture(); Object.assign(app.get(EnvironmentService).values, { nodeEnv: "production" });
    if (source === "mfa") { const original = provisioning; provisioning = async auth => ({ ...(await original(auth))!, testOnly: false }); }
    await expect(service.grant(f.admin.auth, f.input)).rejects.toMatchObject({ status: 403 });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it("keeps default production providers closed even for an eligible ADMIN", async () => {
    const f = await fixture(); Object.assign(app.get(EnvironmentService).values, { nodeEnv: "production" });
    const closed = new AssignmentGrantsService(db.client as unknown as PrismaService, app.get(EnvironmentService),
      new AssignmentGrantProvisioningSource(), new StaffAssuranceSource());
    await expect(closed.grant(f.admin.auth, f.input)).rejects.toMatchObject({ status: 503 });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it.each(["wrong-user", "inactive", "wrong-role"])("rejects invalid trusted provisioning: %s", async state => {
    const f = await fixture(), original = provisioning;
    provisioning = async auth => ({ ...(await original(auth))!, ...(state === "wrong-user" ? { userId: "another" } : state === "inactive" ? { active: false } : { role: "MODERATOR" }) }) as AssignmentGrantAdminProvisioning;
    await expect(service.grant(f.admin.auth, f.input)).rejects.toMatchObject({ status: 403 });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it.each(["wrong-session", "wrong-user", "expired", "future"])("rejects invalid MFA: %s", async state => {
    const f = await fixture(), original = mfa;
    mfa = async auth => ({ ...(await original(auth))!, ...(state === "wrong-session" ? { sessionId: "another" } :
      state === "wrong-user" ? { userId: "another" } : state === "expired" ? { expiresAt: new Date(0) } : { verifiedAt: new Date("2099-01-01") }) });
    await expect(service.grant(f.admin.auth, f.input)).rejects.toMatchObject({ status: 403 });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it.each(["MEMBER", "EXPERT", "ADMIN", "suspended", "unverified", "missing"])("does not grant to target %s", async target => {
    const f = await fixture();
    if (["MEMBER", "EXPERT", "ADMIN"].includes(target)) await db.client.user.update({ where: { id: f.seed.moderator.id }, data: { role: target as UserRole } });
    if (target === "suspended") await db.client.user.update({ where: { id: f.seed.moderator.id }, data: { status: "SUSPENDED" } });
    if (target === "unverified") await db.client.user.update({ where: { id: f.seed.moderator.id }, data: { emailVerifiedAt: null } });
    await expect(service.grant(f.admin.auth, { ...f.input, ...(target === "missing" ? { moderatorId: "missing" } : {}) })).rejects.toMatchObject({ status: 404 });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it("rejects forged input authority, nullable expiry and invalid revisions", async () => {
    const f = await fixture();
    for (const field of ["actorId", "role", "mfa", "provisioning", "createdAt", "grantId", "wildcard", "scope"]) {
      await expect(service.grant(f.admin.auth, { ...f.input, [field]: "forged" })).rejects.toMatchObject({ status: 400 });
      await expect(service.revoke(f.admin.auth, { scopeId: randomUUID(), grantId: randomUUID(), expectedRevision: 1, [field === "grantId" ? "actorEvidence" : field]: "forged" })).rejects.toMatchObject({ status: 400 });
    }
    for (const value of [null, undefined, "not-a-date", "2000-01-01T00:00:00.000Z"])
      await expect(service.grant(f.admin.auth, { ...f.input, expiresAt: value })).rejects.toMatchObject({ status: 400 });
    for (const expectedRevision of [-1, 0.5, "0", Number.MAX_SAFE_INTEGER])
      await expect(service.grant(f.admin.auth, { ...f.input, expectedRevision })).rejects.toMatchObject({ status: 400 });
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it("requires current revision and an explicit revoke before replacing a valid grant", async () => {
    const f = await fixture();
    await expect(service.grant(f.admin.auth, { ...f.input, expectedRevision: 1 })).rejects.toMatchObject({ status: 409 });
    const first = await service.grant(f.admin.auth, f.input), before = await count(f.assignment.id);
    await expect(service.grant(f.admin.auth, f.input)).rejects.toMatchObject({ status: 409 });
    await expect(service.grant(f.admin.auth, { ...f.input, expectedRevision: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(service.revoke(f.admin.auth, { ...revokeBody(first), expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
    expect(await count(f.assignment.id)).toEqual(before);
    await service.revoke(f.admin.auth, revokeBody(first));
    await expect(service.revoke(f.admin.auth, revokeBody(first))).rejects.toMatchObject({ status: 409 });
  });
  it("regrants after natural expiry with a distinct lifecycle and never extends the old event", async () => {
    const f = await fixture(), deadline = await future(1000);
    const first = await service.grant(f.admin.auth, { ...f.input, expiresAt: deadline.toISOString() });
    const event = await db.client.assignmentModeratorGrantEvent.findUnique({ where: { id: first.grantId } });
    await db.client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3s'");
      await tx.$queryRaw`SELECT true AS elapsed FROM pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (${deadline}::timestamptz - clock_timestamp())))::double precision + 0.05)`;
    }, { timeout: 5000 });
    const second = await service.grant(f.admin.auth, { ...f.input, expectedRevision: 1 });
    expect(second).toMatchObject({ revision: 2, kind: "GRANTED" }); expect(second.grantId).not.toBe(first.grantId);
    expect(await db.client.assignmentModeratorGrantEvent.findUnique({ where: { id: first.grantId } })).toEqual(event);
    expect((await count(f.assignment.id)).events.map(e => e.kind)).toEqual(["GRANTED", "GRANTED"]);
  });
  it.each(["grant", "revoke"] as const)("audit INSERT failure rolls back %s and retained identities/events", async operation => {
    const f = await fixture(), first = operation === "revoke" ? await service.grant(f.admin.auth, f.input) : undefined;
    const before = await count(f.assignment.id), identities = await db.client.expertActorIdentity.findMany({ orderBy: { userId: "asc" } });
    await db.client.$executeRawUnsafe(`CREATE FUNCTION c035_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private detail'; END $$`);
    await db.client.$executeRawUnsafe('CREATE TRIGGER c035_test_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION c035_test_audit_failure()');
    try {
      const result = operation === "grant" ? service.grant(f.admin.auth, f.input) : service.revoke(f.admin.auth, revokeBody(first!));
      await expect(result).rejects.toMatchObject({ status: 503, response: { code: "ASSIGNMENT_GRANT_UNAVAILABLE" } });
      expect(await count(f.assignment.id)).toEqual(before);
      expect(await db.client.expertActorIdentity.findMany({ orderBy: { userId: "asc" } })).toEqual(identities);
    } finally {
      await db.client.$executeRawUnsafe('DROP TRIGGER c035_test_audit_failure ON "AuditLog"');
      await db.client.$executeRawUnsafe('DROP FUNCTION c035_test_audit_failure()');
    }
  });
  it.each(["session", "mfa", "grant-expiry"])("fresh database clock rejects %s expiry during trusted-source I/O", async bound => {
    const f = await fixture(), deadline = await future(1000), original = provisioning;
    let enteredSource = false;
    if (bound === "session") await db.client.session.update({ where: { id: f.admin.session.id }, data: { expiresAt: deadline } });
    if (bound === "mfa") { const base = mfa; mfa = async auth => ({ ...(await base(auth))!, expiresAt: deadline }); }
    provisioning = async auth => { enteredSource = true; await db.client.$queryRaw`SELECT true AS elapsed FROM pg_sleep(1.1)`; return original(auth); };
    await expect(service.grant(f.admin.auth, { ...f.input, ...(bound === "grant-expiry" ? { expiresAt: deadline.toISOString() } : {}) }))
      .rejects.toMatchObject({ status: bound === "session" ? 401 : bound === "mfa" ? 403 : 400 });
    expect(enteredSource).toBe(true);
    expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
  });
  it("rejects session expiry after a proven ADMIN User-lock wait without committing grant evidence", async () => {
    const f = await fixture(), deadline = await future(1000);
    await db.client.session.update({ where: { id: f.admin.session.id }, data: { expiresAt: deadline } });
    let entered!: () => void, release!: () => void, pid = 0;
    const ready = new Promise<void>(resolve => { entered = resolve; }), finish = new Promise<void>(resolve => { release = resolve; });
    const blocker = db.client.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.admin.row.id} FOR UPDATE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pid = backend.pid; entered(); await finish;
    }, { timeout: 10000 });
    let request: Promise<unknown> | undefined;
    try {
      await Promise.race([ready, blocker]);
      request = service.grant(f.admin.auth, f.input).then(value => ({ value }), error => ({ error }));
      let waiting = false;
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const rows = await db.client.$queryRaw<{ pid: number }[]>`SELECT a.pid FROM pg_stat_activity a
          WHERE a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND position('FROM "User"' IN a.query)>0
            AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='"User"'::regclass)`;
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await db.client.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3s'");
        await tx.$queryRaw`SELECT true AS elapsed FROM pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (${deadline}::timestamptz - clock_timestamp())))::double precision + 0.05)`;
      }, { timeout: 5000 });
      release(); await blocker;
      expect(await request).toMatchObject({ error: { status: 401 } });
      expect(await count(f.assignment.id)).toEqual({ scopes: [], events: [], audits: [] });
    } finally { release(); await Promise.allSettled([blocker, ...(request ? [request] : [])]); }
  });
  it.each(["grant", "revoke"] as const)("MFA expiry during the final %s audit rolls back the whole transaction", async operation => {
    const f = await fixture(), first = operation === "revoke" ? await service.grant(f.admin.auth, f.input) : undefined;
    const before = await count(f.assignment.id), deadline = await future(1000), original = mfa;
    mfa = async auth => ({ ...(await original(auth))!, expiresAt: deadline });
    await db.client.$executeRawUnsafe("CREATE FUNCTION c035_test_slow_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.1); RETURN NEW; END $$");
    await db.client.$executeRawUnsafe('CREATE TRIGGER c035_test_slow_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION c035_test_slow_audit()');
    const request = (operation === "grant" ? service.grant(f.admin.auth, f.input) : service.revoke(f.admin.auth, revokeBody(first!)))
      .then(value => ({ value }), error => ({ error }));
    try {
      let enteredAudit = false;
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const rows = await db.client.$queryRaw<{ pid: number }[]>`SELECT a.pid FROM pg_stat_activity a
          WHERE a.wait_event='PgSleep' AND position('AuditLog' IN a.query)>0
            AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='"AuditLog"'::regclass)`;
        if (rows.length) { enteredAudit = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(enteredAudit).toBe(true);
      expect(await request).toMatchObject({ error: { status: 403 } });
      expect(await count(f.assignment.id)).toEqual(before);
    } finally {
      await request;
      await db.client.$executeRawUnsafe('DROP TRIGGER c035_test_slow_audit ON "AuditLog"');
      await db.client.$executeRawUnsafe('DROP FUNCTION c035_test_slow_audit()');
    }
  });
  it.each([
    { operation: "grant" as const, differentAdmin: false }, { operation: "grant" as const, differentAdmin: true },
    { operation: "revoke" as const, differentAdmin: false }, { operation: "revoke" as const, differentAdmin: true },
  ])("serializes concurrent $operation requests on observed User contention (different ADMIN: $differentAdmin)", async ({ operation, differentAdmin }) => {
    const f = await fixture(), first = operation === "revoke" ? await service.grant(f.admin.auth, f.input) : undefined;
    const competitor = differentAdmin ? (await user()).auth : f.admin.auth;
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    const original = mfa; let held = false, pid = 0;
    const spy = jest.spyOn(app.get(StaffAssuranceSource), "resolve").mockImplementation(async (tx, auth) => {
      if (!held) { held = true; const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pid = backend.pid; entered(); await barrier; }
      return original(auth);
    });
    const invoke = (auth = f.admin.auth) => operation === "grant" ? service.grant(auth, f.input) : service.revoke(auth, revokeBody(first!));
    const winner = invoke(), observed = winner.then(value => ({ value }), error => ({ error }));
    let loser: Promise<unknown> | undefined;
    try {
      await Promise.race([ready, winner]); loser = invoke(competitor).then(value => ({ value }), error => ({ error }));
      let waiting = false;
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const rows = await db.client.$queryRaw<{ pid: number }[]>`SELECT a.pid FROM pg_stat_activity a
          WHERE a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND position('FROM "User"' IN a.query)>0
            AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='"User"'::regclass)`;
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true); release();
      expect(await observed).toHaveProperty("value.kind", operation === "grant" ? "GRANTED" : "REVOKED");
      expect(await loser).toMatchObject({ error: { status: 409 } });
      const state = await count(f.assignment.id);
      expect(state.events).toHaveLength(operation === "grant" ? 1 : 2);
      expect(state.audits).toHaveLength(operation === "grant" ? 1 : 2);
    } finally { release(); await Promise.allSettled([winner, ...(loser ? [loser] : [])]); spy.mockRestore(); }
  });
  it("can revoke retained grants after target/video deletion without creating new authority", async () => {
    const f = await fixture(), first = await service.grant(f.admin.auth, f.input);
    await db.client.video.delete({ where: { id: f.seed.video.id } });
    await db.client.user.delete({ where: { id: f.seed.moderator.id } });
    expect(await service.revoke(f.admin.auth, revokeBody(first))).toMatchObject({ revision: 2, kind: "REVOKED" });
    const state = await count(f.assignment.id);
    expect(state.scopes[0].currentGrantId).toBeNull(); expect(state.events).toHaveLength(2); expect(state.audits).toHaveLength(2);
    await expect(service.grant(f.admin.auth, { ...f.input, expectedRevision: 2 })).rejects.toMatchObject({ status: 404 });
  });
});
