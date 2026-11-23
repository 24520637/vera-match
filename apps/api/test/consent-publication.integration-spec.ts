import type { ConsentReadDto } from "../src/consent/consent.validation";
import type { ConsentService } from "../src/consent/consent.service";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConsentPurpose, UserRole } from "@prisma/client";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/configure-app";
import { parseEnvironment } from "../src/config/environment";
import { EnvironmentService } from "../src/config/environment.service";
import { PrismaService } from "../src/database/prisma.service";
import { PasswordService } from "../src/auth/password.service";
import { ConsentPolicyRegistry, consentPurposes, policyDigest } from "../src/consent/consent.policy";
import { ConsentAccessService } from "../src/consent/consent-access.service";
import { candidateNotices, candidatePolicyVersion } from "../src/consent/consent-policy.catalog";
import { policyApprovalMessage } from "../src/consent/consent-policy.publication";
import { createAuthDatabase } from "./disposable-auth-database";

/** Real publication mechanism, ephemeral synthetic authority, disposable database.
 * Nothing here grants real production approval or installs a host key. */
describe("Signed policy publication / real HTTP and PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>, app: INestApplication, base: string;
  let directory: string, manifest: string, key: string;
  const origin = "http://localhost:3000";
  beforeAll(async () => {
    db = await createAuthDatabase(); directory = mkdtempSync(join(tmpdir(), "vera-policy-http-"));
    manifest = join(directory, "approval.json"); key = join(directory, "approval.pub");
    const authority = generateKeyPairSync("ed25519");
    const now = Date.now();
    const payload = { schemaVersion: 1, publicationId: "synthetic-http-fixture", approvedByReference: "synthetic-authority-not-production", legalBasisReference: "synthetic-fixture-no-legal-approval", approvedAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), policies: consentPurposes.flatMap(purpose => (["en", "vi"] as const).map(locale => ({ purpose, locale, policyVersion: candidatePolicyVersion, content: candidateNotices[purpose][locale], digest: policyDigest(candidateNotices[purpose][locale]) }))) };
    writeFileSync(key, authority.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    writeFileSync(manifest, JSON.stringify({ payload, signature: sign(null, policyApprovalMessage(payload), authority.privateKey).toString("base64url") }), { mode: 0o600 });
  }, 60000);
  beforeEach(async () => {
    const env = jest.replaceProperty(process, "env", { ...process.env, CONSENT_POLICY_MANIFEST_PATH: manifest, CONSENT_POLICY_APPROVAL_PUBLIC_KEY_PATH: key });
    try {
      const values = parseEnvironment({ ...process.env, NODE_ENV: "test", DATABASE_URL: db.url, CORS_ORIGIN: origin });
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EnvironmentService).useValue({ values }).overrideProvider(PrismaService).useValue(db.client).compile();
      app = module.createNestApplication({ logger: false }); configureApplication(app); await app.listen(0,"127.0.0.1"); base = await app.getUrl();
    } finally { env.restore(); }
  });
  afterEach(async () => { jest.restoreAllMocks(); await app?.close(); });
  afterAll(async () => { try { await db?.close(); } finally { if (manifest) unlinkSync(manifest); if (key) unlinkSync(key); if (directory) rmdirSync(directory); } });
  const request = (cookie: string, path = "me", body?: unknown, idempotency = randomUUID()) => fetch(base + "/api/consents/" + path, { method: body === undefined ? "GET" : "PATCH", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "Idempotency-Key": idempotency }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function member(role: UserRole = "MEMBER") {
    const password = "synthetic-policy-member-password";
    const user = await db.client.user.create({ data: { email: randomUUID() + "@example.invalid", passwordHash: await app.get(PasswordService).hash(password), status: "ACTIVE", role, declaredAdult: true, emailVerifiedAt: new Date() } });
    const response = await fetch(base + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email, password }) });
    expect(response.status).toBe(200);
    return { ...user, cookie: response.headers.get("set-cookie")!.split(";")[0] };
  }
  const grant = (purpose: ConsentPurpose, locale: "en" | "vi" = "en") => ({ purpose, granted: true, policyVersion: candidatePolicyVersion, locale, policyDigest: policyDigest(candidateNotices[purpose][locale]) });
  it("serves exact optional EN/VI notices only to active members; no approval metadata or writes", async () => {
    expect((await request("", "policies")).status).toBe(401);
    for (const role of ["ADMIN", "MODERATOR", "EXPERT"] as const) expect((await request((await member(role)).cookie, "policies")).status).toBe(403);
    const user = await member();
    for (const locale of ["en", "vi"] as const) {
      const response = await request(user.cookie, "policies?locale=" + locale);
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
      const result = await response.json() as ReturnType<ConsentService["published"]>; expect(result.locale).toBe(locale); expect(result.policies).toHaveLength(5);
      for (const entry of result.policies) expect(entry).toMatchObject({ locale, optional: true, policyVersion: candidatePolicyVersion, content: candidateNotices[entry.purpose as ConsentPurpose][locale], digest: policyDigest(entry.content) });
      expect(JSON.stringify(result)).not.toMatch(/synthetic-http-fixture|legalBasisReference|signature|approvedByReference/);
    }
    expect((await request(user.cookie, "policies?locale=fr")).status).toBe(400);
    expect((await request(user.cookie, "policies?locale=en&userId=other")).status).toBe(400);
    expect(await db.client.consentLedger.findUnique({ where: { userId: user.id } })).toBeNull();
  });
  it("starts OFF and grants only each explicitly selected purpose", async () => {
    const user = await member(); const initial = await (await request(user.cookie)).json() as ConsentReadDto;
    expect(initial.consents.every((c: {granted:boolean}) => !c.granted)).toBe(true);
    for (const [index,purpose] of consentPurposes.entries()) {
      const response = await request(user.cookie, "me", { expectedVersion: index, consents: [grant(purpose)] });
      expect(response.status).toBe(200); const state = await response.json() as ConsentReadDto;
      expect(state.consents.filter((c: {granted:boolean}) => c.granted)).toHaveLength(index + 1);
      expect(await app.get(ConsentAccessService).isAllowed(user.id,purpose)).toBe(true);
    }
  });
  it.each(["missing-locale", "missing-digest", "wrong-locale", "wrong-digest", "old-version"])("rejects %s without persisting a grant", async variant => {
    const user = await member(); const item: Record<string,unknown> = grant("VIDEO_STORAGE");
    if (variant === "missing-locale") delete item.locale;
    if (variant === "missing-digest") delete item.policyDigest;
    if (variant === "wrong-locale") item.locale = "vi";
    if (variant === "wrong-digest") item.policyDigest = "0".repeat(64);
    if (variant === "old-version") item.policyVersion = "2026-11-22.v0";
    expect((await request(user.cookie,"me",{ expectedVersion: 0, consents: [item] })).status).toBe(400);
    expect(await db.client.consentLedger.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await app.get(ConsentAccessService).isAllowed(user.id,"VIDEO_STORAGE")).toBe(false);
  });
  it("persists immutable exact locale evidence and only explicit re-consent changes the binding", async () => {
    const user = await member();
    expect((await request(user.cookie,"me",{ expectedVersion: 0, consents: [grant("VIDEO_STORAGE","en")] })).status).toBe(200);
    const first = await db.client.consent.findUniqueOrThrow({ where: { userId_purpose: { userId: user.id, purpose: "VIDEO_STORAGE" } }, include: { policyEvidence: true } });
    expect(first.policyEvidence).toMatchObject({ locale: "en", content: candidateNotices.VIDEO_STORAGE.en, digest: policyDigest(candidateNotices.VIDEO_STORAGE.en), testOnly: false });
    expect((await request(user.cookie,"me",{ expectedVersion: 1, consents: [grant("VIDEO_STORAGE","vi")] })).status).toBe(200);
    const second = await db.client.consent.findUniqueOrThrow({ where: { userId_purpose: { userId: user.id, purpose: "VIDEO_STORAGE" } }, include: { policyEvidence: true } });
    expect(second.policyEvidenceId).not.toBe(first.policyEvidenceId); expect(second.policyEvidence!.locale).toBe("vi");
    await expect(db.client.consentPolicyEvidence.update({ where: { id: first.policyEvidenceId! }, data: { content: "rewritten" } })).rejects.toThrow();
    const events = await db.client.consentEvent.findMany({ where: { subjectId: (await db.client.consentLedger.findUniqueOrThrow({ where: { userId: user.id } })).subjectId }, orderBy: { nextVersion: "asc" } });
    expect(events.map(e => e.kind)).toEqual(["STATE_CHANGED", "POLICY_RECONSENT"]);
  });
  it("replays the same locale/digest once but rejects changed consent evidence under the same key", async () => {
    const user = await member(), key = randomUUID(), body = { expectedVersion: 0, consents: [grant("VIDEO_STORAGE")] };
    expect((await request(user.cookie,"me",body,key)).status).toBe(200);
    const replay = await request(user.cookie,"me",body,key); expect(replay.status).toBe(200); expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect((await request(user.cookie,"me",{ expectedVersion: 0, consents: [grant("VIDEO_STORAGE","vi")] },key)).status).toBe(409);
    const ledger = await db.client.consentLedger.findUniqueOrThrow({ where: { userId: user.id } });
    expect(await db.client.consentEvent.count({ where: { subjectId: ledger.subjectId } })).toBe(1);
  });
  it("withdraws while publication is unavailable and regrant never revives the old generation", async () => {
    const user = await member();
    expect((await request(user.cookie,"me",{ expectedVersion: 0, consents: [grant("VIDEO_STORAGE")] })).status).toBe(200);
    const original = await db.client.consentLedger.findUniqueOrThrow({ where: { userId: user.id } });
    const registry = app.get(ConsentPolicyRegistry), current = registry.current.bind(registry);
    const unavailable = jest.spyOn(registry,"current").mockReturnValue(undefined);
    expect(await app.get(ConsentAccessService).isAllowed(user.id,"VIDEO_STORAGE")).toBe(false);
    expect((await request(user.cookie,"me",{ expectedVersion: 1, consents: [{ purpose: "VIDEO_STORAGE", granted: false }] })).status).toBe(200);
    expect((await request(user.cookie,"me",{ expectedVersion: 2, consents: [grant("VIDEO_STORAGE")] })).status).toBe(400);
    unavailable.mockImplementation(current);
    expect((await request(user.cookie,"me",{ expectedVersion: 2, consents: [grant("VIDEO_STORAGE","vi")] })).status).toBe(200);
    expect(await app.get(ConsentAccessService).isAllowed(user.id,"VIDEO_STORAGE")).toBe(true);
    await expect(db.client.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', user.id);
      return app.get(ConsentAccessService).requireGenerationInTransaction(tx,user.id,original.subjectId,original.version,"VIDEO_STORAGE");
    })).rejects.toMatchObject({ response: { code: "CONSENT_GENERATION_WITHDRAWN" } });
  });
  it("uses signed non-test policy evidence in ordinary-runtime checks without a testOnly bypass", async () => {
    const user = await member(); const environment = app.get(EnvironmentService);
    const previous = environment.values; Object.defineProperty(environment,"values",{ value: { ...previous, nodeEnv: "production" }, configurable: true });
    try {
      expect((await request(user.cookie,"me",{ expectedVersion: 0, consents: [grant("VIDEO_STORAGE")] })).status).toBe(200);
      expect(await app.get(ConsentAccessService).isAllowed(user.id,"VIDEO_STORAGE")).toBe(true);
    } finally { Object.defineProperty(environment,"values",{ value: previous, configurable: true }); }
  });
});
