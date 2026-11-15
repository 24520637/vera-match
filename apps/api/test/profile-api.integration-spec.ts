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

describe("C020 own-profile HTTP / disposable PostgreSQL", () => {
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
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterEach(async () => { await app?.close(); });
  afterAll(async () => { await database?.close(); });

  async function member(role: UserRole = UserRole.MEMBER, status: AccountStatus = AccountStatus.ACTIVE, verified = true) {
    const token = randomBytes(32).toString("base64url");
    const user = await database.client.user.create({ data: {
      email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-not-for-login", displayName: "User-owned name",
      role, status, emailVerifiedAt: verified ? new Date() : null,
      sessions: { create: { tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 600000) } },
    } });
    return { ...user, cookie: `${app.get(EnvironmentService).values.session.cookieName}=${token}` };
  }
  function request(cookie: string, method = "GET", body?: unknown, suffix = "", headers: Record<string, string> = {}) {
    return fetch(`${base}/api/profile/me${suffix}`, { method,
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const revision = (userId: string) => database.client.memberResourceRevision.findUnique({ where: {
    userId_resource: { userId, resource: MemberResource.PROFILE },
  } });

  it("requires a valid active verified MEMBER session on GET and PATCH", async () => {
    for (const method of ["GET", "PATCH"]) {
      expect((await request("", method, method === "PATCH" ? { expectedRevision: 0, city: "x" } : undefined)).status).toBe(401);
    }
    for (const status of [AccountStatus.PENDING_EMAIL, AccountStatus.SUSPENDED, AccountStatus.DELETED]) {
      const user = await member(UserRole.MEMBER, status);
      expect((await request(user.cookie)).status).toBe(401);
    }
    const unverified = await member(UserRole.MEMBER, AccountStatus.ACTIVE, false);
    expect((await request(unverified.cookie)).status).toBe(401);
    for (const role of [UserRole.EXPERT, UserRole.MODERATOR, UserRole.ADMIN]) {
      const staff = await member(role);
      expect((await request(staff.cookie)).status).toBe(403);
      expect((await request(staff.cookie, "PATCH", { expectedRevision: 0, city: "x" })).status).toBe(403);
    }
    const revoked = await member();
    await database.client.session.updateMany({ where: { userId: revoked.id }, data: { revokedAt: new Date() } });
    expect((await request(revoked.cookie)).status).toBe(401);
    const expired = await member();
    await database.client.session.updateMany({ where: { userId: expired.id }, data: { expiresAt: new Date(0) } });
    expect((await request(expired.cookie)).status).toBe(401);
  });

  it("returns null/virtual zero without provisioning profile, revision or consent data", async () => {
    const user = await member();
    for (let i = 0; i < 2; i++) {
      const response = await request(user.cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ revision: 0, profile: null });
    }
    expect(await database.client.profile.count({ where: { userId: user.id } })).toBe(0);
    expect(await revision(user.id)).toBeNull();
    expect(await database.client.consent.count({ where: { userId: user.id } })).toBe(0);
  });

  it("derives identity only from session and preserves User displayName", async () => {
    const a = await member(), b = await member();
    await database.client.profile.create({ data: { userId: b.id, city: "Other private city" } });
    expect((await request(a.cookie, "PATCH", { expectedRevision: 0, city: "Injected", userId: b.id })).status).toBe(400);
    expect((await request(a.cookie, "PATCH", { expectedRevision: 0, displayName: "Moved" })).status).toBe(400);
    expect((await request(a.cookie, "GET", undefined, `?userId=${b.id}`)).status).toBe(400);
    expect((await fetch(`${base}/api/profile/${b.id}`, { headers: { Cookie: a.cookie } })).status).toBe(404);
    expect((await request(a.cookie, "PATCH", { expectedRevision: 0, city: "Own" })).status).toBe(200);
    expect((await database.client.profile.findUniqueOrThrow({ where: { userId: b.id } })).city).toBe("Other private city");
    expect((await database.client.user.findUniqueOrThrow({ where: { id: a.id } })).displayName).toBe("User-owned name");
    expect(await revision(b.id)).toBeNull();
  });

  it("normalizes text and persists omission, SQL null and empty arrays distinctly", async () => {
    const user = await member();
    const first = await request(user.cookie, "PATCH", { expectedRevision: 0, city: " Cafe\u0301 ",
      bio: " First\r\nSecond ", birthDate: "2000-02-29", interests: ["reading"], values: ["kindness"] });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ revision: 1, profile: { city: "Café", bio: "First\nSecond", birthDate: "2000-02-29", visibilityEnabled: false } });
    const second = await request(user.cookie, "PATCH", { expectedRevision: 1, city: null, interests: [], values: null });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ revision: 2, profile: { city: null, interests: [], values: null, bio: "First\nSecond" } });
    const [stored] = await database.client.$queryRaw<{ sql_null: boolean; birth: Date }[]>`
      SELECT "values" IS NULL AS sql_null, "birthDate" AS birth FROM "Profile" WHERE "userId" = ${user.id}`;
    expect(stored.sql_null).toBe(true);
    expect(stored.birth.toISOString()).toBe("2000-02-29T00:00:00.000Z");
    expect(await revision(user.id)).toMatchObject({ revision: 2n });
    expect(await database.client.memberResourceRevision.count({ where: { userId: user.id } })).toBe(1);
  });

  it("rejects invalid fields with visible nested paths and no writes", async () => {
    const user = await member();
    for (const body of [{ expectedRevision: "0", city: "x" }, { expectedRevision: 0 },
      { expectedRevision: 0, birthDate: "2020-01-01" }, { expectedRevision: 0, visibilityEnabled: null },
      { expectedRevision: 0, city: " " }, { expectedRevision: 0, occupation: "x".repeat(121) },
      { expectedRevision: 0, bio: "x".repeat(2001) }, { expectedRevision: 0, role: "ADMIN" }]) {
      const response = await request(user.cookie, "PATCH", body);
      expect(response.status).toBe(400);
      const error = await response.json() as { code: string; details: unknown[] };
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(Array.isArray(error.details)).toBe(true);
      expect(error.details.length).toBeGreaterThan(0);
    }
    const indexed = await request(user.cookie, "PATCH", { expectedRevision: 0, interests: ["reading", "unknown"] });
    expect(indexed.status).toBe(400);
    expect(await indexed.json()).toMatchObject({ details: [{ field: "interests.1" }] });
    expect(await revision(user.id)).toBeNull();
    expect(await database.client.profile.count({ where: { userId: user.id } })).toBe(0);
  });

  it("uses exact Origin/JSON policies and separate feature rate limits with Retry-After", async () => {
    const user = await member();
    const body = { expectedRevision: 0, city: "x" };
    expect((await request(user.cookie, "PATCH", body, "", { Origin: "https://foreign.invalid" })).status).toBe(403);
    expect((await request(user.cookie, "PATCH", body, "", { "Content-Type": "text/plain" })).status).toBe(415);
    const limiter = app.get(ProfileRateLimiter);
    for (let i = 0; i < 20; i++) limiter.consume("profile:patch", user.id, 20, 60000);
    const limited = await request(user.cookie, "PATCH", body);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await revision(user.id)).toBeNull();
    expect((await request(user.cookie)).status).toBe(200);
    for (let i = 1; i < 120; i++) limiter.consume("feature:read", user.id, 120, 60000);
    expect((await request(user.cookie)).status).toBe(429);
    const auth = await fetch(`${base}/api/auth/me`, { headers: { Cookie: user.cookie } });
    expect(auth.status).toBe(200);
    const other = await member();
    // Fill only the socket-IP ceiling; a different member cannot bypass it.
    let ipLimited = false;
    for (let i = 0; i < 600; i++) {
      try { limiter.consume("feature:non-withdrawal:ip", "127.0.0.1", 600, 60000); }
      catch { ipLimited = true; break; }
    }
    expect(ipLimited).toBe(true);
    const ceiling = await request(other.cookie);
    expect(ceiling.status).toBe(429);
    expect(Number(ceiling.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("rejects stale writes and increments nonempty equal-value writes across row clears", async () => {
    const user = await member();
    expect((await request(user.cookie, "PATCH", { expectedRevision: 1, city: "x" })).status).toBe(409);
    expect(await revision(user.id)).toBeNull();
    expect((await request(user.cookie, "PATCH", { expectedRevision: 0, city: "x" })).status).toBe(200);
    const stale = await request(user.cookie, "PATCH", { expectedRevision: 0, city: "old" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "RESOURCE_REVISION_CONFLICT", details: [{ field: "_form" }] });
    expect((await request(user.cookie, "PATCH", { expectedRevision: 1, city: "x" })).status).toBe(200);
    await database.client.profile.delete({ where: { userId: user.id } });
    expect(await (await request(user.cookie)).json()).toEqual({ revision: 2, profile: null });
    const recreated = await request(user.cookie, "PATCH", { expectedRevision: 2, city: null });
    expect(recreated.status).toBe(200);
    expect(await recreated.json()).toMatchObject({ revision: 3 });
  });

  it("serializes concurrent first writes and updates: exactly one winner per revision", async () => {
    const user = await member();
    for (const expectedRevision of [0, 1]) {
      const responses = await Promise.all(["A", "B"].map(city => request(user.cookie, "PATCH", { expectedRevision, city })));
      expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
      const winner = await responses.find(response => response.status === 200)!.json();
      expect(await (await request(user.cookie)).json()).toEqual(winner);
    }
    expect(await revision(user.id)).toMatchObject({ revision: 2n });
  });

  it("returns safe actionable legacy errors, never repairs omitted fields, and allows explicit corrections", async () => {
    const user = await member();
    const original = await database.client.profile.create({ data: { userId: user.id, city: "Keep",
      interests: { private_key: "PRIVATE-LEGACY" }, birthDate: new Date("2000-01-01T12:00:00Z") } });
    const get = await request(user.cookie);
    expect(get.status).toBe(503);
    const error = await get.json();
    expect(get.headers.get("cache-control")).toContain("no-store");
    expect(error).toMatchObject({ code: "DATA_SHAPE_UNAVAILABLE", resource: "profile", revision: 0,
      remediation: { fields: ["birthDate", "interests"] } });
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE-LEGACY|private_key|12:00|SELECT/);
    expect((await request(user.cookie, "PATCH", { expectedRevision: 1, city: "x" })).status).toBe(409);
    expect((await request(user.cookie, "PATCH", { expectedRevision: 0, city: "Changed" })).status).toBe(503);
    expect((await request(user.cookie, "PATCH", { expectedRevision: 0, interests: [] })).status).toBe(503);
    expect(await database.client.profile.findUnique({ where: { userId: user.id } })).toEqual(original);
    expect(await revision(user.id)).toBeNull();
    const fixed = await request(user.cookie, "PATCH", { expectedRevision: 0, interests: [], birthDate: null });
    expect(fixed.status).toBe(200);
    expect(await fixed.json()).toMatchObject({ revision: 1, profile: { interests: [], birthDate: null, city: "Keep" } });
  });

  it("projects JSON null as API null without rewriting omitted storage", async () => {
    const user = await member();
    await database.client.profile.create({ data: { userId: user.id, values: Prisma.JsonNull } });
    expect(await (await request(user.cookie)).json()).toMatchObject({ profile: { values: null } });
    expect((await request(user.cookie, "PATCH", { expectedRevision: 0, city: "Only city" })).status).toBe(200);
    const [stored] = await database.client.$queryRaw<{ json_null: boolean }[]>`
      SELECT "values" = 'null'::jsonb AS json_null FROM "Profile" WHERE "userId" = ${user.id}`;
    expect(stored.json_null).toBe(true);
  });

  it("rolls back initialized revision when profile persistence fails and hides database errors", async () => {
    const user = await member();
    await database.client.$executeRawUnsafe(`CREATE FUNCTION c020_fail_profile() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.city = 'synthetic-storage-failure' THEN RAISE EXCEPTION 'PRIVATE SQL failure'; END IF; RETURN NEW; END $$`);
    await database.client.$executeRawUnsafe(`CREATE TRIGGER c020_profile_failure BEFORE INSERT OR UPDATE ON "Profile"
      FOR EACH ROW EXECUTE FUNCTION c020_fail_profile()`);
    try {
      const failed = await request(user.cookie, "PATCH", { expectedRevision: 0, city: "synthetic-storage-failure" });
      expect(failed.status).toBe(503);
      expect(await failed.json()).toEqual({ code: "PROFILE_STORE_UNAVAILABLE", message: "Profile storage is temporarily unavailable." });
      expect(await revision(user.id)).toBeNull();
      expect(await database.client.profile.count({ where: { userId: user.id } })).toBe(0);
      expect((await request(user.cookie, "PATCH", { expectedRevision: 0, city: "Original" })).status).toBe(200);
      const failedUpdate = await request(user.cookie, "PATCH", { expectedRevision: 1, city: "synthetic-storage-failure" });
      expect(failedUpdate.status).toBe(503);
      expect(await revision(user.id)).toMatchObject({ revision: 1n });
      expect((await database.client.profile.findUniqueOrThrow({ where: { userId: user.id } })).city).toBe("Original");
    } finally {
      await database.client.$executeRawUnsafe(`DROP TRIGGER c020_profile_failure ON "Profile"`);
      await database.client.$executeRawUnsafe(`DROP FUNCTION c020_fail_profile()`);
    }
  });

  it("keeps preferences/questionnaire counters independent and never wraps an exhausted profile revision", async () => {
    const user = await member();
    await database.client.memberResourceRevision.createMany({ data: [
      { userId: user.id, resource: MemberResource.PROFILE, revision: BigInt(Number.MAX_SAFE_INTEGER) },
      { userId: user.id, resource: MemberResource.PREFERENCES, revision: 9n },
      { userId: user.id, resource: MemberResource.QUESTIONNAIRE, revision: 6n },
    ] });
    const exhausted = await request(user.cookie, "PATCH", { expectedRevision: Number.MAX_SAFE_INTEGER, city: "x" });
    expect(exhausted.status).toBe(503);
    expect(await exhausted.json()).toMatchObject({ code: "PROFILE_REVISION_EXHAUSTED" });
    expect(await revision(user.id)).toMatchObject({ revision: BigInt(Number.MAX_SAFE_INTEGER) });
    const rows = await database.client.memberResourceRevision.findMany({ where: { userId: user.id } });
    expect(rows.find(row => row.resource === MemberResource.PREFERENCES)?.revision).toBe(9n);
    expect(rows.find(row => row.resource === MemberResource.QUESTIONNAIRE)?.revision).toBe(6n);
    expect(await database.client.profile.count({ where: { userId: user.id } })).toBe(0);
  });
});
