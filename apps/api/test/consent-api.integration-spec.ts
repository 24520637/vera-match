import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AccountStatus, ConsentPurpose, UserRole } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { hashSessionToken } from "../src/auth/session-token";
import { configureApplication } from "../src/configure-app";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { PrismaService } from "../src/database/prisma.service";
import { ConsentAccessService } from "../src/consent/consent-access.service";
import { ConsentPolicyRegistry, consentPurposes, policyDigest, PolicySnapshot } from "../src/consent/consent.policy";
import { ConsentWithdrawalLimiter } from "../src/consent/consent-request.guard";
import { ProfileRateLimiter } from "../src/profile/profile-request.guard";
import { createAuthDatabase } from "./disposable-auth-database";

/** Not registered by production code. These snapshots are test fixtures, not policies. */
class SyntheticPolicies extends ConsentPolicyRegistry {
  version = "synthetic-v1";
  override current(purpose: ConsentPurpose): PolicySnapshot {
    return { purpose, policyVersion: this.version, locale: "en-test", testOnly: true,
      content: `TEST ONLY - NOT A LEGAL POLICY - ${purpose} - ${this.version}` };
  }
}
const choices = (granted: boolean, purposes: ConsentPurpose[] = consentPurposes) => purposes.map(purpose =>
  granted ? { purpose, granted, policyVersion: "synthetic-v1" } : { purpose, granted });

describe("C023 consent HTTP / disposable PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createAuthDatabase>>;
  let app: INestApplication;
  let base: string;
  let policies: SyntheticPolicies;
  const origin = "http://localhost:3000";
  beforeAll(async () => { database = await createAuthDatabase(); }, 60000);
  beforeEach(async () => {
    policies = new SyntheticPolicies();
    const values = parseEnvironment({ ...process.env, NODE_ENV: "test", DATABASE_URL: database.url,
      CORS_ORIGIN: origin, MINIO_ROOT_USER: "synthetic-test", MINIO_ROOT_PASSWORD: "synthetic-test-only" });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EnvironmentService).useValue({ values })
      .overrideProvider(PrismaService).useValue(database.client)
      .overrideProvider(ConsentPolicyRegistry).useValue(policies).compile();
    app = module.createNestApplication({ logger: false }); configureApplication(app);
    await app.listen(0, "127.0.0.1"); base = await app.getUrl();
  });
  afterEach(async () => { jest.restoreAllMocks(); await app?.close(); });
  afterAll(async () => { await database?.close(); });
  async function member(role: UserRole = UserRole.MEMBER, status: AccountStatus = AccountStatus.ACTIVE, verified = true) {
    const token = randomBytes(32).toString("base64url");
    const user = await database.client.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-not-for-login",
      role, status, emailVerifiedAt: verified ? new Date() : null,
      sessions: { create: { tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 600000) } },
    } });
    return { ...user, cookie: `${app.get(EnvironmentService).values.session.cookieName}=${token}` };
  }
  const request = (cookie: string, body?: unknown, key: string = randomUUID(), suffix = "", headers: Record<string, string> = {}) =>
    fetch(`${base}/api/consents/me${suffix}`, { method: body === undefined ? "GET" : "PATCH",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "Idempotency-Key": key, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
  const patch = (cookie: string, expectedVersion: number, granted: boolean, key = randomUUID(), purposes = consentPurposes) =>
    request(cookie, { expectedVersion, consents: choices(granted, purposes) }, key);
  const ledger = (userId: string) => database.client.consentLedger.findUniqueOrThrow({ where: { userId } });
  const access = () => app.get(ConsentAccessService);

  it("GET projects exactly five OFF states and virtual version 0 without any writes", async () => {
    const user = await member();
    for (let i = 0; i < 2; i++) {
      const response = await request(user.cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ version: 0, consents: consentPurposes.map(purpose => ({
        purpose, granted: false, grantedAt: null, revokedAt: null, policyVersion: null, updatedAt: null,
      })) });
    }
    expect(await database.client.consent.count({ where: { userId: user.id } })).toBe(0);
    expect(await database.client.consentLedger.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await access().isAllowed(user.id, "PROFILE_MATCHING")).toBe(false);
  });

  it("requires active verified MEMBER sessions, with no staff bypass or client-selected identity", async () => {
    expect((await request("")).status).toBe(401);
    expect((await patch("", 0, false)).status).toBe(401);
    for (const role of [UserRole.EXPERT, UserRole.MODERATOR, UserRole.ADMIN]) {
      const user = await member(role);
      expect((await request(user.cookie)).status).toBe(403);
      expect((await patch(user.cookie, 0, false)).status).toBe(403);
    }
    for (const status of [AccountStatus.PENDING_EMAIL, AccountStatus.SUSPENDED, AccountStatus.DELETED]) {
      const user = await member(UserRole.MEMBER, status);
      expect((await patch(user.cookie, 0, false)).status).toBe(401);
    }
    const unverified = await member(UserRole.MEMBER, AccountStatus.ACTIVE, false);
    expect((await request(unverified.cookie)).status).toBe(401);
    const a = await member(), b = await member();
    expect((await request(a.cookie, { expectedVersion: 0, consents: choices(false), userId: b.id })).status).toBe(400);
    expect((await request(a.cookie, undefined, randomUUID(), `?userId=${b.id}`)).status).toBe(400);
    expect((await fetch(`${base}/api/consents/${b.id}`, { headers: { Cookie: a.cookie } })).status).toBe(404);
    expect(await database.client.consentLedger.findUnique({ where: { userId: b.id } })).toBeNull();
  });

  it("fails closed without a current policy and rejects synthetic policies outside test; revoke still succeeds", async () => {
    const user = await member();
    const registry = jest.spyOn(policies, "current").mockReturnValue(undefined as unknown as PolicySnapshot);
    const grant = await patch(user.cookie, 0, true);
    expect(grant.status).toBe(400);
    expect(await grant.json()).toMatchObject({ details: [{ field: "consents.0.policyVersion" }] });
    expect(await database.client.consentLedger.findUnique({ where: { userId: user.id } })).toBeNull();
    registry.mockRestore();
    expect((await patch(user.cookie, 0, true)).status).toBe(200);
    const environment = app.get(EnvironmentService);
    const previous = environment.values;
    Object.defineProperty(environment, "values", { value: { ...previous, nodeEnv: "production" }, configurable: true });
    expect((await patch(user.cookie, 1, true)).status).toBe(400);
    expect(await access().isAllowed(user.id, "VIDEO_STORAGE")).toBe(false);
    expect((await patch(user.cookie, 1, false)).status).toBe(200);
  });

  it("grants five purposes with immutable exact policy snapshots and authoritative checks", async () => {
    const user = await member();
    const result = await patch(user.cookie, 0, true);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ version: 1, consents: consentPurposes.map(purpose => ({ purpose, granted: true, policyVersion: "synthetic-v1" })) });
    const mapping = await ledger(user.id);
    const events = await database.client.consentEvent.findMany({ where: { subjectId: mapping.subjectId }, include: { policyEvidence: true } });
    expect(events).toHaveLength(5);
    for (const event of events) {
      expect(event.kind).toBe("STATE_CHANGED");
      expect(event.evidenceGap).toBe(false);
      expect(event.policyEvidence!.digest).toBe(policyDigest(event.policyEvidence!.content));
      expect(await access().isAllowed(user.id, event.purpose)).toBe(true);
    }
    expect(await database.client.consentIdempotency.count({ where: { subjectId: mapping.subjectId } })).toBe(1);
    expect(await database.client.consentWithdrawalTask.count({ where: { subjectId: mapping.subjectId } })).toBe(0);
    expect(await access().withAuthorizedConsent(user.id, "PROFILE_MATCHING", async (_tx, version) => Number(version))).toBe(1);
  });

  it("revokes without consulting the registry, retains accepted policy and durably records obligations", async () => {
    const user = await member();
    expect((await patch(user.cookie, 0, true)).status).toBe(200);
    const granted = await database.client.consent.findFirstOrThrow({ where: { userId: user.id } });
    await database.client.profile.create({ data: { userId: user.id, interests: { malformed: true } } });
    jest.spyOn(policies, "current").mockImplementation(() => { throw new Error("Registry offline"); });
    const revoked = await request(user.cookie, { expectedVersion: 1,
      consents: consentPurposes.map(purpose => ({ purpose, granted: false, policyVersion: "stale-ignored" })) });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ version: 2, consents: consentPurposes.map(purpose => ({ purpose, granted: false, policyVersion: "synthetic-v1" })) });
    const state = await database.client.consent.findUniqueOrThrow({ where: { userId_purpose: { userId: user.id, purpose: granted.purpose } } });
    expect(state.grantedAt).toEqual(granted.grantedAt);
    expect(state.revokedAt).not.toBeNull();
    const mapping = await ledger(user.id);
    expect(await database.client.consentWithdrawalTask.count({ where: { subjectId: mapping.subjectId, status: "PENDING" } })).toBe(5);
    for (const purpose of consentPurposes) expect(await access().isAllowed(user.id, purpose)).toBe(false);
    await expect(access().withAuthorizedConsent(user.id, "PROFILE_MATCHING", async () => true)).rejects.toMatchObject({ status: 403 });
  });

  it("advances explicit OFF and distinguishes grant reaffirmation and policy re-consent", async () => {
    const user = await member();
    expect((await patch(user.cookie, 0, false)).status).toBe(200);
    expect((await patch(user.cookie, 1, false)).status).toBe(200);
    expect((await patch(user.cookie, 2, true)).status).toBe(200);
    expect((await patch(user.cookie, 3, true)).status).toBe(200);
    policies.version = "synthetic-v2";
    expect((await request(user.cookie, { expectedVersion: 4, consents: consentPurposes.map(purpose => ({ purpose, granted: true, policyVersion: "synthetic-v2" })) })).status).toBe(200);
    const mapping = await ledger(user.id);
    for (const [version, kind] of [[1, "OFF_REAFFIRMED"], [2, "OFF_REAFFIRMED"], [3, "STATE_CHANGED"], [4, "GRANT_REAFFIRMED"], [5, "POLICY_RECONSENT"]] as const) {
      expect(await database.client.consentEvent.count({ where: { subjectId: mapping.subjectId, nextVersion: BigInt(version), kind } })).toBe(5);
    }
    const evidence = await database.client.consentPolicyEvidence.findFirstOrThrow({ where: { purpose: "PROFILE_MATCHING", policyVersion: "synthetic-v1" } });
    await expect(database.client.consentPolicyEvidence.update({ where: { id: evidence.id }, data: { content: "Rewrite" } })).rejects.toThrow();
  });

  it("serializes concurrent first writes and stale grants against withdrawal without auto retries", async () => {
    const user = await member();
    const first = await Promise.all([patch(user.cookie, 0, false), patch(user.cookie, 0, true)]);
    expect(first.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await patch(user.cookie, 1, false)).status).toBe(200);
    const stale = await patch(user.cookie, 1, true);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await ledger(user.id)).version).toBe(2n);
    expect(await access().isAllowed(user.id, "VIDEO_STORAGE")).toBe(false);
  });

  it("deduplicates concurrent identical keys, replays historical results, and conflicts on changed payloads", async () => {
    const user = await member(), key = randomUUID();
    const responses = await Promise.all([patch(user.cookie, 0, true, key), patch(user.cookie, 0, true, key)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(responses.filter(response => response.headers.get("idempotency-replayed") === "true")).toHaveLength(1);
    const bodies = await Promise.all(responses.map(response => response.json())); expect(bodies[0]).toEqual(bodies[1]);
    const mapping = await ledger(user.id);
    expect(await database.client.consentEvent.count({ where: { subjectId: mapping.subjectId } })).toBe(5);
    expect((await patch(user.cookie, 1, false)).status).toBe(200);
    jest.spyOn(policies, "current").mockImplementation(() => { throw new Error("Policy changed"); });
    const replay = await patch(user.cookie, 0, true, key);
    expect(replay.status).toBe(200); expect(await replay.json()).toEqual(bodies[0]);
    expect(await access().isAllowed(user.id, "PROFILE_MATCHING")).toBe(false);
    const reused = await patch(user.cookie, 2, false, key);
    expect(reused.status).toBe(409); expect(await reused.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await database.client.user.update({ where: { id: user.id }, data: { status: AccountStatus.SUSPENDED } });
    expect((await patch(user.cookie, 0, true, key)).status).toBe(401);
  });

  it("does not replay expired records or reset aggregate versions after deduplication expiry", async () => {
    const user = await member(), key = randomUUID();
    expect((await patch(user.cookie, 0, false, key)).status).toBe(200);
    const mapping = await ledger(user.id);
    await database.client.consentIdempotency.updateMany({ where: { subjectId: mapping.subjectId }, data: { expiresAt: new Date(0) } });
    expect((await patch(user.cookie, 0, false, key)).status).toBe(409);
    expect((await ledger(user.id)).version).toBe(1n);
    expect(await database.client.consentEvent.count({ where: { subjectId: mapping.subjectId } })).toBe(5);
  });

  it("keeps evidence/tasks after account deletion and rejects ordinary evidence update/delete/truncate", async () => {
    const user = await member();
    expect((await patch(user.cookie, 0, true)).status).toBe(200);
    expect((await patch(user.cookie, 1, false)).status).toBe(200);
    const mapping = await ledger(user.id);
    const events = await database.client.consentEvent.findMany({ where: { subjectId: mapping.subjectId } });
    await expect(database.client.consentEvent.update({ where: { id: events[0].id }, data: { evidenceGap: true } })).rejects.toThrow();
    await expect(database.client.consentEvent.delete({ where: { id: events[0].id } })).rejects.toThrow();
    await expect(database.client.$executeRawUnsafe('TRUNCATE "ConsentEvent" CASCADE')).rejects.toThrow();
    const policy = await database.client.consentPolicyEvidence.findFirstOrThrow();
    await expect(database.client.consentPolicyEvidence.delete({ where: { id: policy.id } })).rejects.toThrow();
    await database.client.user.delete({ where: { id: user.id } });
    expect(await database.client.consentLedger.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await database.client.consentEvent.findMany({ where: { subjectId: mapping.subjectId } })).toEqual(events);
    expect(await database.client.consentWithdrawalTask.count({ where: { subjectId: mapping.subjectId } })).toBe(5);
    expect(await database.client.consentIdempotency.count({ where: { subjectId: mapping.subjectId } })).toBe(2);
    expect(await access().isAllowed(user.id, "VIDEO_STORAGE")).toBe(false);
    expect((await request(user.cookie)).status).toBe(401);
    expect(JSON.stringify(events, (_key, value) => typeof value === "bigint" ? value.toString() : value)).not.toContain(user.id);
  });

  it("withdraws legacy grants without inventing missing evidence or blocking on malformed feature data", async () => {
    const user = await member();
    await database.client.consent.create({ data: { userId: user.id, purpose: "VIDEO_STORAGE", granted: true, grantedAt: new Date() } });
    expect(await access().isAllowed(user.id, "VIDEO_STORAGE")).toBe(false);
    expect((await patch(user.cookie, 0, false, randomUUID(), ["VIDEO_STORAGE"])).status).toBe(200);
    const mapping = await ledger(user.id);
    expect(await database.client.consentEvent.findFirst({ where: { subjectId: mapping.subjectId } })).toMatchObject({ evidenceGap: true, policyEvidenceId: null });
  });

  it("rolls back state, subject/version, events, evidence, result and task when any required write fails", async () => {
    const user = await member();
    for (const table of ["ConsentEvent", "ConsentIdempotency", "ConsentWithdrawalTask"]) {
      const totals = { events: await database.client.consentEvent.count(), subjects: await database.client.consentSubject.count() };
      await database.client.$executeRawUnsafe(`CREATE FUNCTION c023_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE SQL'; END $$`);
      await database.client.$executeRawUnsafe(`CREATE TRIGGER c023_failure BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION c023_fail_write()`);
      try {
        const failed = await patch(user.cookie, 0, false);
        expect(failed.status).toBe(503);
        expect(await failed.json()).toEqual({ code: "CONSENT_STORE_UNAVAILABLE", message: "Consent storage is temporarily unavailable." });
        expect(await database.client.consentLedger.findUnique({ where: { userId: user.id } })).toBeNull();
        expect(await database.client.consent.count({ where: { userId: user.id } })).toBe(0);
        expect(await database.client.consentEvent.count()).toBe(totals.events);
        expect(await database.client.consentSubject.count()).toBe(totals.subjects);
      } finally {
        await database.client.$executeRawUnsafe(`DROP TRIGGER c023_failure ON "${table}"`);
        await database.client.$executeRawUnsafe(`DROP FUNCTION c023_fail_write()`);
      }
    }
  });

  it("keeps withdrawal quota independent of exhausted general/grant/read quota and includes Retry-After", async () => {
    const user = await member(), feature = app.get(ProfileRateLimiter);
    for (let i = 0; i < 600; i++) feature.consume("feature:non-withdrawal:ip", "127.0.0.1", 600, 60000);
    expect((await request(user.cookie)).status).toBe(429);
    expect((await patch(user.cookie, 0, true)).status).toBe(429);
    expect((await patch(user.cookie, 0, false)).status).toBe(200);
    const withdrawal = app.get(ConsentWithdrawalLimiter);
    for (let i = 1; i < 60; i++) withdrawal.consume("consent:revoke:member", user.id, 60, 60000);
    const limited = await patch(user.cookie, 1, false);
    expect(limited.status).toBe(429); expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await ledger(user.id)).version).toBe(1n);
  });

  it("rolls back newly created policy snapshots as well as grant state/events when the result write fails", async () => {
    const user = await member();
    policies.version = `synthetic-rollback-${randomUUID()}`;
    const evidenceBefore = await database.client.consentPolicyEvidence.count();
    const eventBefore = await database.client.consentEvent.count();
    await database.client.$executeRawUnsafe(`CREATE FUNCTION c023_fail_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE'; END $$`);
    await database.client.$executeRawUnsafe(`CREATE TRIGGER c023_result_failure BEFORE INSERT ON "ConsentIdempotency" FOR EACH ROW EXECUTE FUNCTION c023_fail_result()`);
    try {
      const response = await request(user.cookie, { expectedVersion: 0,
        consents: consentPurposes.map(purpose => ({ purpose, granted: true, policyVersion: policies.version })) });
      expect(response.status).toBe(503);
      expect(await database.client.consentLedger.findUnique({ where: { userId: user.id } })).toBeNull();
      expect(await database.client.consent.count({ where: { userId: user.id } })).toBe(0);
      expect(await database.client.consentPolicyEvidence.count()).toBe(evidenceBefore);
      expect(await database.client.consentEvent.count()).toBe(eventBefore);
      expect(await access().isAllowed(user.id, "VIDEO_STORAGE")).toBe(false);
    } finally {
      await database.client.$executeRawUnsafe(`DROP TRIGGER c023_result_failure ON "ConsentIdempotency"`);
      await database.client.$executeRawUnsafe(`DROP FUNCTION c023_fail_result()`);
    }
  });

  it("validates headers, policy types, Origin/JSON and mixed batches without writes", async () => {
    const user = await member();
    expect((await request(user.cookie, { expectedVersion: 0, consents: choices(false) }, "short")).status).toBe(400);
    expect((await request(user.cookie, { expectedVersion: 0, consents: [{ purpose: "VIDEO_STORAGE", granted: true }] })).status).toBe(400);
    expect((await request(user.cookie, { expectedVersion: 0, consents: [...choices(false, ["VIDEO_STORAGE"]), ...choices(true, ["PROFILE_MATCHING"])] })).status).toBe(400);
    expect((await request(user.cookie, { expectedVersion: 0, consents: choices(false) }, randomUUID(), "", { Origin: "https://foreign.invalid" })).status).toBe(403);
    expect((await request(user.cookie, { expectedVersion: 0, consents: choices(false) }, randomUUID(), "", { "Content-Type": "text/plain" })).status).toBe(415);
    expect(await database.client.consentLedger.findUnique({ where: { userId: user.id } })).toBeNull();
  });
});
