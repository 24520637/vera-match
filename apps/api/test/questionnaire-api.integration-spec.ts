import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AccountStatus, MemberResource, UserRole } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { hashSessionToken } from "../src/auth/session-token";
import { configureApplication } from "../src/configure-app";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { PrismaService } from "../src/database/prisma.service";
import { ProfileRateLimiter } from "../src/profile/profile-request.guard";
import { QuestionnaireCatalog } from "../src/questionnaire/questionnaire.catalog";
import { createAuthDatabase } from "./disposable-auth-database";

const keys = ["relationship-intention", "everyday-life", "values-and-boundaries"];
const payload = (expectedRevision = 0, questionnaireVersion = 1) => ({ expectedRevision, questionnaireVersion,
  answers: keys.map(questionKey => ({ questionKey, responseText: `Synthetic ${questionKey}` })) });

describe("C021 own questionnaire / disposable PostgreSQL", () => {
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
  afterEach(async () => { jest.restoreAllMocks(); await app?.close(); });
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
    fetch(`${base}/api/questionnaire/me${suffix}`, { method: body === undefined ? "GET" : "PUT",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const revision = (userId: string) => database.client.memberResourceRevision.findUnique({ where: {
    userId_resource: { userId, resource: MemberResource.QUESTIONNAIRE },
  } });

  it("requires active verified MEMBER sessions and rejects staff, expired and revoked sessions", async () => {
    expect((await request("")).status).toBe(401);
    expect((await request("", payload())).status).toBe(401);
    for (const role of [UserRole.EXPERT, UserRole.MODERATOR, UserRole.ADMIN]) {
      const user = await member(role);
      expect((await request(user.cookie)).status).toBe(403);
      expect((await request(user.cookie, payload())).status).toBe(403);
    }
    for (const status of [AccountStatus.PENDING_EMAIL, AccountStatus.SUSPENDED, AccountStatus.DELETED]) {
      const user = await member(UserRole.MEMBER, status);
      expect((await request(user.cookie)).status).toBe(401);
    }
    const unverified = await member(UserRole.MEMBER, AccountStatus.ACTIVE, false);
    expect((await request(unverified.cookie, payload())).status).toBe(401);
    for (const mode of ["revoked", "expired"]) {
      const user = await member();
      await database.client.session.updateMany({ where: { userId: user.id },
        data: mode === "revoked" ? { revokedAt: new Date() } : { expiresAt: new Date(0) } });
      expect((await request(user.cookie)).status).toBe(401);
    }
  });

  it("GET returns read-only defaults with no resource, revision, profile or consent provisioning", async () => {
    const user = await member();
    for (let i = 0; i < 2; i++) {
      const response = await request(user.cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ revision: 0, questionnaire: { questionnaireVersion: 1, answers: [] } });
    }
    expect(await revision(user.id)).toBeNull();
    expect(await database.client.questionnaireAnswer.count({ where: { userId: user.id } })).toBe(0);
    expect(await database.client.profile.count({ where: { userId: user.id } })).toBe(0);
    expect(await database.client.consent.count({ where: { userId: user.id } })).toBe(0);
  });

  it("saves all three normalized answers in catalog order and reloads identically", async () => {
    const user = await member();
    const dto = payload(); dto.answers.reverse(); dto.answers[0].responseText = " Cafe\u0301\r\nline ";
    const response = await request(user.cookie, dto);
    expect(response.status).toBe(200);
    const saved = await response.json() as { revision: number; questionnaire: { answers: { questionKey: string; responseText: string }[] } };
    expect(saved.revision).toBe(1);
    expect(saved.questionnaire.answers.map(answer => answer.questionKey)).toEqual(keys);
    expect(saved.questionnaire.answers[2].responseText).toBe("Café\nline");
    expect(await (await request(user.cookie)).json()).toEqual(saved);
    expect((await request(user.cookie, payload(1))).status).toBe(200);
    expect(await revision(user.id)).toMatchObject({ revision: 2n });
    expect(await database.client.questionnaireAnswer.count({ where: { userId: user.id } })).toBe(3);
  });

  it("enforces ownership and rejects unsupported versions/fields/selectors and nested invalid answers", async () => {
    const a = await member(), b = await member();
    expect((await request(b.cookie, payload())).status).toBe(200);
    for (const dto of [{ ...payload(), userId: b.id }, { ...payload(), expectedRevision: "0" },
      { ...payload(), answers: payload().answers.slice(0, 2) }, { ...payload(), questionnaireVersion: 2 },
      { ...payload(), answers: [...payload().answers, payload().answers[0]] }]) {
      expect((await request(a.cookie, dto)).status).toBe(400);
    }
    const bad = payload(); bad.answers[1].responseText = " "; bad.answers[2].questionKey = bad.answers[0].questionKey;
    const invalid = await request(a.cookie, bad);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "VALIDATION_FAILED", details: [
      { field: "answers.1.responseText" }, { field: "answers.2.questionKey" },
    ] });
    for (const suffix of [`?userId=${b.id}`, "?questionnaireVersion=99", "?questionnaireVersion=1&questionnaireVersion=1"]) {
      expect((await request(a.cookie, undefined, suffix)).status).toBe(400);
    }
    expect((await request(a.cookie, payload(), "?questionnaireVersion=1")).status).toBe(400);
    expect((await fetch(`${base}/api/questionnaire/${b.id}`, { headers: { Cookie: a.cookie } })).status).toBe(404);
    expect(await database.client.questionnaireAnswer.count({ where: { userId: a.id } })).toBe(0);
    expect(await revision(a.id)).toBeNull();
    expect(await revision(b.id)).toMatchObject({ revision: 1n });
  });

  it("reads a synthetic registered retired catalog, rejects its PUT, and preserves all older rows", async () => {
    const user = await member();
    const registry = app.get(QuestionnaireCatalog);
    const current = registry.find(1)!;
    // Test-only catalog; production has only the approved version 1.
    jest.spyOn(registry, "find").mockImplementation(version => version === 2
      ? { ...current, version: 2, retired: true } : version === 1 ? current : undefined);
    await database.client.questionnaireAnswer.createMany({ data: keys.map(questionKey => ({
      userId: user.id, questionKey, questionnaireVersion: 2, responseText: "Synthetic retired meaning",
    })) });
    const before = await database.client.questionnaireAnswer.findMany({ where: { userId: user.id, questionnaireVersion: 2 } });
    const retired = await request(user.cookie, undefined, "?questionnaireVersion=2");
    expect(retired.status).toBe(200);
    expect(await retired.json()).toMatchObject({ revision: 0, questionnaire: { questionnaireVersion: 2 } });
    const rejected = await request(user.cookie, payload(0, 2));
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "QUESTIONNAIRE_VERSION_RETIRED", details: [{ field: "_form" }] });
    expect(await revision(user.id)).toBeNull();
    expect((await request(user.cookie, payload())).status).toBe(200);
    expect(await database.client.questionnaireAnswer.findMany({ where: { userId: user.id, questionnaireVersion: 2 } })).toEqual(before);
    expect(await (await request(user.cookie, undefined, "?questionnaireVersion=2")).json()).toMatchObject({ revision: 1 });
  });

  it("allows exactly one concurrent initialization/update and never automatically retries stale operations", async () => {
    const user = await member();
    for (const expectedRevision of [0, 1]) {
      const results = await Promise.all(["A", "B"].map(text => {
        const dto = payload(expectedRevision); dto.answers[0].responseText = text; return request(user.cookie, dto);
      }));
      expect(results.map(response => response.status).sort()).toEqual([200, 409]);
      expect(await (await request(user.cookie)).json()).toEqual(await results.find(response => response.status === 200)!.json());
    }
    const stale = await request(user.cookie, payload(1));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "RESOURCE_REVISION_CONFLICT" });
    await database.client.questionnaireAnswer.deleteMany({ where: { userId: user.id } });
    expect(await (await request(user.cookie)).json()).toEqual({ revision: 2, questionnaire: { questionnaireVersion: 1, answers: [] } });
    expect((await request(user.cookie, payload(2))).status).toBe(200);
    expect(await revision(user.id)).toMatchObject({ revision: 3n });
  });

  it("fails safely on partial/malformed legacy sets; full PUT explicitly replaces known answers but never unknown rows", async () => {
    const user = await member();
    await database.client.questionnaireAnswer.create({ data: { userId: user.id, questionKey: keys[0], responseText: "PRIVATE-LEGACY  " } });
    const invalid = await request(user.cookie);
    expect(invalid.status).toBe(503);
    const error = await invalid.json();
    expect(error).toMatchObject({ code: "DATA_SHAPE_UNAVAILABLE", resource: "questionnaire", revision: 0, remediation: { fields: ["answers"] } });
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE-LEGACY/);
    expect((await request(user.cookie, payload())).status).toBe(200);
    const extra = await database.client.questionnaireAnswer.create({ data: { userId: user.id,
      questionKey: "PRIVATE-UNKNOWN-KEY", responseText: "Never delete", questionnaireVersion: 1 } });
    const before = await database.client.questionnaireAnswer.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });
    const blocked = await request(user.cookie, payload(1));
    expect(blocked.status).toBe(503);
    expect(JSON.stringify(await blocked.json())).not.toMatch(/PRIVATE-UNKNOWN-KEY|Never delete/);
    expect(await database.client.questionnaireAnswer.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await revision(user.id)).toMatchObject({ revision: 1n });
    expect(await database.client.questionnaireAnswer.findUnique({ where: { id: extra.id } })).toEqual(extra);
  });

  it("preserves unknown legacy versions and ignores malformed Profile data", async () => {
    const user = await member();
    const old = await database.client.questionnaireAnswer.create({ data: { userId: user.id,
      questionKey: "legacy-key", questionnaireVersion: 99, responseText: "Preserve unknown catalog" } });
    await database.client.profile.create({ data: { userId: user.id, interests: { private: "Malformed" } } });
    expect((await request(user.cookie, payload())).status).toBe(200);
    expect(await database.client.questionnaireAnswer.findUnique({ where: { id: old.id } })).toEqual(old);
    expect(await database.client.memberResourceRevision.count({ where: { userId: user.id } })).toBe(1);
    expect(await database.client.consent.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rolls back the revision and all answer writes if a later answer fails", async () => {
    const user = await member();
    await database.client.$executeRawUnsafe(`CREATE FUNCTION c021_fail_answer() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."responseText" = 'synthetic-storage-failure' THEN RAISE EXCEPTION 'PRIVATE SQL failure'; END IF; RETURN NEW; END $$`);
    await database.client.$executeRawUnsafe(`CREATE TRIGGER c021_answer_failure BEFORE INSERT OR UPDATE ON "QuestionnaireAnswer"
      FOR EACH ROW EXECUTE FUNCTION c021_fail_answer()`);
    try {
      for (const expectedRevision of [0, 1]) {
        const before = await database.client.questionnaireAnswer.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });
        const dto = payload(expectedRevision); dto.answers[2].responseText = "synthetic-storage-failure";
        const failed = await request(user.cookie, dto);
        expect(failed.status).toBe(503);
        expect(await failed.json()).toEqual({ code: "QUESTIONNAIRE_STORE_UNAVAILABLE", message: "Questionnaire storage is temporarily unavailable." });
        expect(await database.client.questionnaireAnswer.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } })).toEqual(before);
        if (expectedRevision === 0) {
          expect(await revision(user.id)).toBeNull();
          expect((await request(user.cookie, payload())).status).toBe(200);
        } else expect(await revision(user.id)).toMatchObject({ revision: 1n });
      }
    } finally {
      await database.client.$executeRawUnsafe(`DROP TRIGGER c021_answer_failure ON "QuestionnaireAnswer"`);
      await database.client.$executeRawUnsafe(`DROP FUNCTION c021_fail_answer()`);
    }
  });

  it("enforces Origin/JSON and independent PUT limits while sharing feature GET quota with Profile", async () => {
    const user = await member();
    expect((await request(user.cookie, payload(), "", { Origin: "https://foreign.invalid" })).status).toBe(403);
    expect((await request(user.cookie, payload(), "", { "Content-Type": "text/plain" })).status).toBe(415);
    const limiter = app.get(ProfileRateLimiter);
    for (let i = 0; i < 10; i++) limiter.consume("questionnaire:put", user.id, 10, 60000);
    const limited = await request(user.cookie, payload());
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await revision(user.id)).toBeNull();
    expect((await fetch(`${base}/api/profile/me`, { headers: { Cookie: user.cookie } })).status).toBe(200);
    for (let i = 1; i < 120; i++) limiter.consume("feature:read", user.id, 120, 60000);
    expect((await request(user.cookie)).status).toBe(429);
    expect((await fetch(`${base}/api/auth/me`, { headers: { Cookie: user.cookie } })).status).toBe(200);
  });
});
