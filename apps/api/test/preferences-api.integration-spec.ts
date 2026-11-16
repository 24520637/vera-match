import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AccountStatus, MemberResource, Prisma, UserRole } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { hashSessionToken } from "../src/auth/session-token";
import { configureApplication } from "../src/configure-app";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { PrismaService } from "../src/database/prisma.service";
import { ProfileRateLimiter } from "../src/profile/profile-request.guard";
import { createAuthDatabase } from "./disposable-auth-database";

describe("C022 own preferences / disposable PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createAuthDatabase>>;
  let app: INestApplication;
  let base: string;
  const origin = "http://localhost:3000";
  beforeAll(async () => { database = await createAuthDatabase(); }, 60000);
  beforeEach(async () => {
    const values = parseEnvironment({ ...process.env, NODE_ENV: "test", DATABASE_URL: database.url,
      CORS_ORIGIN: origin, MINIO_ROOT_USER: "synthetic-test", MINIO_ROOT_PASSWORD: "synthetic-test-only" });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EnvironmentService).useValue({ values })
      .overrideProvider(PrismaService).useValue(database.client).compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, "127.0.0.1"); base = await app.getUrl();
  });
  afterEach(async () => { await app?.close(); });
  afterAll(async () => { await database?.close(); });
  async function member(role: UserRole = UserRole.MEMBER, status: AccountStatus = AccountStatus.ACTIVE, verified = true) {
    const token = randomBytes(32).toString("base64url");
    const user = await database.client.user.create({ data: {
      email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-not-for-login", role, status,
      emailVerifiedAt: verified ? new Date() : null,
      sessions: { create: { tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 600000) } },
    } });
    return { ...user, cookie: `${app.get(EnvironmentService).values.session.cookieName}=${token}` };
  }
  const request = (cookie: string, body?: unknown, suffix = "", headers: Record<string, string> = {}) =>
    fetch(`${base}/api/preferences/me${suffix}`, { method: body === undefined ? "GET" : "PATCH",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
  const revision = (userId: string) => database.client.memberResourceRevision.findUnique({ where: {
    userId_resource: { userId, resource: MemberResource.PREFERENCES },
  } });

  it("requires active verified MEMBER sessions with no staff bypass", async () => {
    expect((await request("")).status).toBe(401);
    expect((await request("", { expectedRevision: 0, minAge: 18 })).status).toBe(401);
    for (const role of [UserRole.EXPERT, UserRole.MODERATOR, UserRole.ADMIN]) {
      const user = await member(role);
      expect((await request(user.cookie)).status).toBe(403);
      expect((await request(user.cookie, { expectedRevision: 0, minAge: 18 })).status).toBe(403);
    }
    for (const status of [AccountStatus.PENDING_EMAIL, AccountStatus.SUSPENDED, AccountStatus.DELETED]) {
      const user = await member(UserRole.MEMBER, status);
      expect((await request(user.cookie)).status).toBe(401);
    }
    const unverified = await member(UserRole.MEMBER, AccountStatus.ACTIVE, false);
    expect((await request(unverified.cookie)).status).toBe(401);
    for (const expired of [true, false]) {
      const user = await member();
      await database.client.session.updateMany({ where: { userId: user.id },
        data: expired ? { expiresAt: new Date(0) } : { revokedAt: new Date() } });
      expect((await request(user.cookie)).status).toBe(401);
    }
  });

  it("GET returns null/virtual zero and does not create any resource, revision or consent", async () => {
    const user = await member();
    for (let i = 0; i < 2; i++) {
      const response = await request(user.cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ revision: 0, preferences: null });
    }
    expect(await revision(user.id)).toBeNull();
    expect(await database.client.matchPreference.count({ where: { userId: user.id } })).toBe(0);
    expect(await database.client.profile.count({ where: { userId: user.id } })).toBe(0);
    expect(await database.client.consent.count({ where: { userId: user.id } })).toBe(0);
  });

  it("uses session ownership only and rejects privileged fields, query IDs and alternate user routes", async () => {
    const a = await member(), b = await member();
    const other = await database.client.matchPreference.create({ data: { userId: b.id, minAge: 30 } });
    for (const body of [{ expectedRevision: 0, userId: b.id }, { expectedRevision: 0, role: "ADMIN" },
      { expectedRevision: 0, visibilityEnabled: true }, { expectedRevision: 0, granted: true }]) {
      expect((await request(a.cookie, body)).status).toBe(400);
    }
    expect((await request(a.cookie, undefined, `?userId=${b.id}`)).status).toBe(400);
    expect((await fetch(`${base}/api/preferences/${b.id}`, { headers: { Cookie: a.cookie } })).status).toBe(404);
    expect((await request(a.cookie, { expectedRevision: 0, minAge: 18 })).status).toBe(200);
    expect(await database.client.matchPreference.findUnique({ where: { userId: b.id } })).toEqual(other);
    expect(await revision(b.id)).toBeNull();
  });

  it("persists selectable edges, one-sided bounds and merged-state range validation", async () => {
    const user = await member();
    expect((await request(user.cookie, { expectedRevision: 0, minAge: 18, maxAge: 120 })).status).toBe(200);
    expect((await request(user.cookie, { expectedRevision: 1, minAge: 120 })).status).toBe(200);
    const invalid = await request(user.cookie, { expectedRevision: 2, maxAge: 119 });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "VALIDATION_FAILED", details: [{ field: "maxAge" }] });
    expect(await revision(user.id)).toMatchObject({ revision: 2n });
    expect((await request(user.cookie, { expectedRevision: 2, minAge: null, maxAge: 18 })).status).toBe(200);
    expect(await (await request(user.cookie)).json()).toMatchObject({ revision: 3, preferences: { minAge: null, maxAge: 18 } });
    expect((await request(user.cookie, { expectedRevision: 3, minAge: 120, maxAge: null })).status).toBe(200);
    expect(await (await request(user.cookie)).json()).toMatchObject({ preferences: { minAge: 120, maxAge: null } });
  });

  it("keeps exact priority order, goal soft-target storage and null/[]/omitted distinctions", async () => {
    const user = await member();
    const first = await request(user.cookie, { expectedRevision: 0, relationshipGoal: "long-term",
      priorities: ["interests", "values", "relationship-goal"], dealBreakers: [] });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ preferences: { priorities: ["interests", "values", "relationship-goal"], dealBreakers: [] } });
    expect((await request(user.cookie, { expectedRevision: 1, dealBreakers: ["different-relationship-goal"] })).status).toBe(200);
    expect((await request(user.cookie, { expectedRevision: 2, priorities: null, relationshipGoal: null })).status).toBe(200);
    const [stored] = await database.client.$queryRaw<{ sql_null: boolean }[]>`
      SELECT "priorities" IS NULL AS sql_null FROM "MatchPreference" WHERE "userId" = ${user.id}`;
    expect(stored.sql_null).toBe(true);
    expect(await (await request(user.cookie)).json()).toMatchObject({ preferences: {
      priorities: null, relationshipGoal: null, dealBreakers: ["different-relationship-goal"],
    } });
    expect((await request(user.cookie, { expectedRevision: 3, priorities: [], dealBreakers: null })).status).toBe(200);
    expect(await (await request(user.cookie)).json()).toMatchObject({ preferences: { priorities: [], dealBreakers: null } });
    expect(await database.client.profile.count({ where: { userId: user.id } })).toBe(0);
    expect(await database.client.consent.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rejects invalid types, catalogs and array entries with nested errors and no writes", async () => {
    const user = await member();
    for (const body of [{ expectedRevision: "0", minAge: 18 }, { expectedRevision: 0 },
      { expectedRevision: 0, minAge: 17 }, { expectedRevision: 0, maxAge: 121 },
      { expectedRevision: 0, minAge: 18.5 }, { expectedRevision: 0, minAge: "18" },
      { expectedRevision: 0, relationshipGoal: " long-term " }, { expectedRevision: 0, dealBreakers: ["different-relationship-goal", "different-relationship-goal"] }]) {
      expect((await request(user.cookie, body)).status).toBe(400);
    }
    const nested = await request(user.cookie, { expectedRevision: 0, priorities: ["values", "unknown"] });
    expect(nested.status).toBe(400);
    expect(await nested.json()).toMatchObject({ details: [{ field: "priorities.1" }] });
    expect(await revision(user.id)).toBeNull();
    expect(await database.client.matchPreference.count({ where: { userId: user.id } })).toBe(0);
  });

  it("uses independent revisions, rejects stale writes and preserves counters across clears and equal saves", async () => {
    const user = await member();
    await database.client.memberResourceRevision.createMany({ data: [MemberResource.PROFILE, MemberResource.QUESTIONNAIRE]
      .map(resource => ({ userId: user.id, resource, revision: 7n })) });
    expect((await request(user.cookie, { expectedRevision: 1, minAge: 18 })).status).toBe(409);
    expect(await revision(user.id)).toBeNull();
    for (const expectedRevision of [0, 1]) expect((await request(user.cookie, { expectedRevision, minAge: 18 })).status).toBe(200);
    const stale = await request(user.cookie, { expectedRevision: 1, maxAge: 20 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "RESOURCE_REVISION_CONFLICT", details: [{ field: "_form" }] });
    await database.client.matchPreference.delete({ where: { userId: user.id } });
    expect(await (await request(user.cookie)).json()).toEqual({ revision: 2, preferences: null });
    expect((await request(user.cookie, { expectedRevision: 2, minAge: null })).status).toBe(200);
    const rows = await database.client.memberResourceRevision.findMany({ where: { userId: user.id } });
    expect(rows.filter(row => row.resource !== MemberResource.PREFERENCES).every(row => row.revision === 7n)).toBe(true);
    expect(await revision(user.id)).toMatchObject({ revision: 3n });
  });

  it("serializes concurrent initialization/updates without partial state or automatic retry", async () => {
    const user = await member();
    for (const expectedRevision of [0, 1]) {
      const responses = await Promise.all([20, 30].map(minAge => request(user.cookie, { expectedRevision, minAge })));
      expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
      expect(await (await request(user.cookie)).json()).toEqual(await responses.find(response => response.status === 200)!.json());
    }
    expect(await revision(user.id)).toMatchObject({ revision: 2n });
  });

  it("fails safely on malformed legacy data and requires complete explicit correction", async () => {
    const user = await member();
    const original = await database.client.matchPreference.create({ data: { userId: user.id,
      minAge: 90, maxAge: 20, priorities: { private_key: "PRIVATE" } } });
    const get = await request(user.cookie);
    expect(get.status).toBe(503);
    const error = await get.json();
    expect(error).toMatchObject({ code: "DATA_SHAPE_UNAVAILABLE", resource: "preferences", revision: 0,
      remediation: { fields: ["priorities"] } });
    expect(JSON.stringify(error)).not.toMatch(/private_key|PRIVATE/);
    expect((await request(user.cookie, { expectedRevision: 0, relationshipGoal: "exploring" })).status).toBe(503);
    expect((await request(user.cookie, { expectedRevision: 0, priorities: [] })).status).toBe(503);
    expect(await database.client.matchPreference.findUnique({ where: { userId: user.id } })).toEqual(original);
    expect(await revision(user.id)).toBeNull();
    expect((await request(user.cookie, { expectedRevision: 0, priorities: null, minAge: null })).status).toBe(200);
    expect(await (await request(user.cookie)).json()).toMatchObject({ revision: 1, preferences: { minAge: null, maxAge: 20, priorities: null } });
  });

  it("projects JSON null without rewriting it and does not depend on Profile or Questionnaire validity", async () => {
    const user = await member();
    await database.client.matchPreference.create({ data: { userId: user.id, priorities: Prisma.JsonNull } });
    await database.client.profile.create({ data: { userId: user.id, interests: { malformed: true } } });
    expect(await (await request(user.cookie)).json()).toMatchObject({ preferences: { priorities: null } });
    expect((await request(user.cookie, { expectedRevision: 0, maxAge: 120 })).status).toBe(200);
    const [stored] = await database.client.$queryRaw<{ json_null: boolean }[]>`
      SELECT "priorities" = 'null'::jsonb AS json_null FROM "MatchPreference" WHERE "userId" = ${user.id}`;
    expect(stored.json_null).toBe(true);
    expect(await database.client.consent.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rolls back data/revision on persistence failure for both create and update", async () => {
    const user = await member();
    await database.client.$executeRawUnsafe(`CREATE FUNCTION c022_fail_preferences() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."minAge" = 119 THEN RAISE EXCEPTION 'PRIVATE SQL failure'; END IF; RETURN NEW; END $$`);
    await database.client.$executeRawUnsafe(`CREATE TRIGGER c022_preferences_failure BEFORE INSERT OR UPDATE ON "MatchPreference"
      FOR EACH ROW EXECUTE FUNCTION c022_fail_preferences()`);
    try {
      for (const expectedRevision of [0, 1]) {
        const before = await database.client.matchPreference.findUnique({ where: { userId: user.id } });
        const failed = await request(user.cookie, { expectedRevision, minAge: 119 });
        expect(failed.status).toBe(503);
        expect(await failed.json()).toEqual({ code: "PREFERENCES_STORE_UNAVAILABLE", message: "Preferences storage is temporarily unavailable." });
        expect(await database.client.matchPreference.findUnique({ where: { userId: user.id } })).toEqual(before);
        if (expectedRevision === 0) {
          expect(await revision(user.id)).toBeNull();
          expect((await request(user.cookie, { expectedRevision: 0, minAge: 18 })).status).toBe(200);
        } else expect(await revision(user.id)).toMatchObject({ revision: 1n });
      }
    } finally {
      await database.client.$executeRawUnsafe(`DROP TRIGGER c022_preferences_failure ON "MatchPreference"`);
      await database.client.$executeRawUnsafe(`DROP FUNCTION c022_fail_preferences()`);
    }
  });

  it("enforces Origin/JSON, its own PATCH quota and shared GET/IP quota without exhausting Auth", async () => {
    const user = await member(); const body = { expectedRevision: 0, minAge: 18 };
    expect((await request(user.cookie, body, "", { Origin: "https://foreign.invalid" })).status).toBe(403);
    expect((await request(user.cookie, body, "", { "Content-Type": "text/plain" })).status).toBe(415);
    const limiter = app.get(ProfileRateLimiter);
    for (let i = 0; i < 20; i++) limiter.consume("preferences:patch", user.id, 20, 60000);
    const limited = await request(user.cookie, body);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await revision(user.id)).toBeNull();
    expect((await fetch(`${base}/api/profile/me`, { headers: { Cookie: user.cookie } })).status).toBe(200);
    for (let i = 1; i < 120; i++) limiter.consume("feature:read", user.id, 120, 60000);
    expect((await request(user.cookie)).status).toBe(429);
    expect((await fetch(`${base}/api/auth/me`, { headers: { Cookie: user.cookie } })).status).toBe(200);
  });
});
