import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, PrismaClient, type ConsentPurpose, type UserRole } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { AppModule } from "../src/app.module";
import { hashSessionToken } from "../src/auth/session-token";
import { configureApplication } from "../src/configure-app";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { MatchingHandles } from "../src/matching/matching-handles";
import { PrismaService } from "../src/database/prisma.service";
import { ConsentPolicyRegistry } from "../src/consent/consent.policy";
import { createAuthDatabase } from "./disposable-auth-database";

const origin = "http://localhost:3000";
const policyVersion = "synthetic-t14";
type Actor = { id: string; token: string };

describe("T14 real matching HTTP and PostgreSQL", () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createAuthDatabase>>;
  let base: string;
  let configuredClient: PrismaClient | undefined;

  async function startApi(client: PrismaClient) {
    const values = parseEnvironment({ ...process.env, NODE_ENV: "test", DATABASE_URL: db.url,
      CORS_ORIGIN: origin, MINIO_ROOT_USER: "synthetic-test", MINIO_ROOT_PASSWORD: "synthetic-test-only" });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(client)
      .overrideProvider(EnvironmentService).useValue({ values })
      .overrideProvider(ConsentPolicyRegistry).useValue({ current: (purpose: ConsentPurpose) => ({
        purpose, policyVersion, locale: "en-test", content: "Synthetic matching test only.", testOnly: true,
      }) }).compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  }

  beforeEach(async () => {
    db = await createAuthDatabase();
    await startApi(db.client);
  }, 60_000);

  afterEach(async () => {
    try { await app?.close(); } finally {
      try { await configuredClient?.$disconnect(); } finally { await db?.close(); }
      configuredClient = undefined;
    }
  });

  function api(path: string, actor?: Actor, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (actor) headers.set("cookie", `vera_session=${actor.token}`);
    return fetch(`${base}/api/${path}`, { ...init, headers });
  }

  const json = (method: string, value: unknown, site = origin): RequestInit => ({
    method, headers: { "content-type": "application/json", origin: site }, body: JSON.stringify(value),
  });
  async function consent(actor: Actor, granted: boolean, expectedVersion: number, purpose: ConsentPurpose = "PROFILE_MATCHING") {
    const init = json("PATCH", { expectedVersion, consents: [{ purpose, granted,
      ...(granted ? { policyVersion } : {}) }] });
    const response = await api("consents/me", actor, { ...init,
      headers: { ...init.headers, "idempotency-key": randomUUID() } });
    expect(response.status).toBe(200);
  }
  async function user(role: UserRole = "MEMBER", granted = true): Promise<Actor> {
    const token = randomBytes(32).toString("base64url");
    const { id } = await db.client.user.create({ data: {
      email: `${randomUUID()}@example.invalid`, displayName: "Private Name", passwordHash: "synthetic-only",
      role, status: "ACTIVE", emailVerifiedAt: new Date(), declaredAdult: true,
      profile: { create: { birthDate: new Date("1990-01-01"), visibilityEnabled: true,
        relationshipGoal: "long-term", bio: "PRIVATE_BIO" } },
      sessions: { create: { tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 600_000) } },
    } });
    const actor = { id, token };
    if (granted) await consent(actor, true, 0);
    return actor;
  }

  async function newSession(actor: Actor): Promise<Actor> {
    const token = randomBytes(32).toString("base64url");
    await db.client.session.create({ data: { userId: actor.id, tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 600_000) } });
    return { id: actor.id, token };
  }
  async function recommendation(actor: Actor) {
    const response = await api("matches/recommendations", actor);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    const body = await response.json() as { recommendations: { pairId: string }[] };
    expect(body).toMatchObject({ available: true, recommendations: [{ reasons: ["Meets both members’ matching settings."] }] });
    return body.recommendations[0].pairId;
  }
  const decide = (actor: Actor, handle: string, choice = "ACCEPT") => api(`matches/${handle}/decision`, actor, json("POST", { choice }));
  async function decisions(actor: Actor) {
    const response = await api("matches/decisions", actor);
    expect(response.status).toBe(200);
    return (await response.json() as { decisions: { choice: string; available: boolean; mutual: boolean }[] }).decisions;
  }

  it("filters both sides at the API boundary and keeps recommendation GET read-only", async () => {
    const a = await user();
    const b = await user();
    const handle = await recommendation(a);
    expect(handle).not.toContain(b.id);
    const text = await (await api("matches/recommendations", a)).text();
    expect(text).not.toMatch(/Private Name|PRIVATE_BIO|1990-01-01|example.invalid/);
    expect(await db.client.matchPair.count()).toBe(0);
    await db.client.matchPreference.create({ data: { userId: b.id, minAge: 120 } });
    expect(await (await api("matches/recommendations", a)).json()).toEqual({
      available: true, recommendations: [], nextCursor: null,
    });
    expect((await decide(a, handle)).status).toBe(404);
  });

  it("enforces sessions, actor-bound handles, Origin, JSON, strict fields and quotas", async () => {
    const a = await user();
    await user();
    const staff = await user("ADMIN", false);
    const path = `matches/${await recommendation(a)}/decision`;
    const csrf = await api(path, a, json("POST", { choice: "ACCEPT" }, "https://foreign.invalid"));
    expect(csrf.status).toBe(403);
    expect((await api(path, a, { method: "POST", headers: { origin }, body: "x" })).status).toBe(415);
    expect((await api(path, a, json("POST", { choice: "ACCEPT", actorUserId: staff.id }))).status).toBe(400);
    expect((await api(path, a, { ...json("POST", {}), body: "{" })).headers.get("cache-control")).toBe("private, no-store");
    expect((await api(path, undefined, json("POST", { choice: "ACCEPT" }))).status).toBe(401);
    expect((await api("matches/decisions", staff)).status).toBe(403);
    const peer = await user("MEMBER", false);
    expect((await api(path, peer, json("POST", { choice: "ACCEPT" }))).status).toBe(404);
    const secondToken = randomBytes(32).toString("base64url");
    await db.client.session.create({ data: { userId: a.id, tokenHash: hashSessionToken(secondToken),
      expiresAt: new Date(Date.now() + 600_000) } });
    expect((await api(path, { id: a.id, token: secondToken }, json("POST", { choice: "ACCEPT" }))).status).toBe(404);
    const session = await db.client.session.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(a.token) }, include: { user: true } });
    const handles = app.get(MatchingHandles);
    const auth = { sessionId: session.id, user: session.user };
    const payload = handles.read(auth, "decision", path.split("/")[1]);
    if (!payload?.authorization) throw new Error("Expected a valid issued reference");
    const expired = handles.issue(auth, "decision", { ...payload, expires: Date.now() - 1 });
    expect((await decide(a, expired)).status).toBe(404);
    let throttled = await api(path, a, json("POST", {}));
    for (let i = 0; i < 32 && throttled.status !== 429; i++) throttled = await api(path, a, json("POST", {}));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await db.client.matchDecision.count()).toBe(0);
  });

  it("does not charge rejected member requests to the shared proxy quota", async () => {
    const a = await user();
    const b = await user();
    const bHandle = await recommendation(b);
    const proxy = createServer((incoming, outgoing) => {
      const upstream = request(new URL(incoming.url!, base), { method: incoming.method, headers: incoming.headers }, response => {
        outgoing.writeHead(response.statusCode!, response.headers);
        response.pipe(outgoing);
      });
      upstream.on("error", () => { outgoing.writeHead(502).end(); });
      incoming.pipe(upstream);
    });
    await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("Expected a loopback proxy");
    const proxyBase = `http://127.0.0.1:${address.port}/api`;
    try {
      // Query validation occurs after the matching guard and keeps this test off the discovery path.
      for (let i = 0; i < 300; i++) {
        const response = await fetch(`${proxyBase}/matches/recommendations?unsupported=1`, {
          headers: { cookie: `vera_session=${a.token}` },
        });
        expect(response.status).toBe(i < 60 ? 400 : 429);
        await response.arrayBuffer();
      }
      const response = await fetch(`${proxyBase}/matches/${bHandle}/decision`, {
        ...json("POST", { choice: "ACCEPT" }),
        headers: { "content-type": "application/json", origin, cookie: `vera_session=${b.token}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ choice: "ACCEPT", mutual: false });
    } finally {
      await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
    }
  });

  it("serializes two accepts and replays a choice without duplicate records or audit", async () => {
    const a = await user();
    const b = await user();
    const [aHandle, bHandle] = await Promise.all([recommendation(a), recommendation(b)]);
    const results = await Promise.all([decide(a, aHandle), decide(b, bHandle)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const states = await Promise.all(results.map(async r => await r.json() as { mutual: boolean }));
    expect(states.map(r => r.mutual).sort()).toEqual([false, true]);
    expect(await db.client.matchPair.count()).toBe(1);
    expect(await db.client.matchDecision.count()).toBe(2);
    expect(await (await decide(a, aHandle)).json()).toEqual({ choice: "ACCEPT", mutual: true });
    expect((await decide(a, aHandle, "DECLINE")).status).toBe(409);
    expect((await decisions(b))[0]).toMatchObject({ choice: "ACCEPT", available: true, mutual: true });
    const audits = await db.client.auditLog.findMany({ where: { action: "MATCH_DECISION_RECORDED" } });
    expect(audits).toHaveLength(2);
    expect(audits.map(row => row.actorId)).not.toContain(a.id);
    await expect(db.client.auditLog.update({ where: { id: audits[0].id },
      data: { action: "OTHER" } })).rejects.toThrow();
    await expect(db.client.auditLog.delete({ where: { id: audits[0].id } })).rejects.toThrow();
    const { actorId, action, subjectType, subjectId } = audits[0];
    await expect(db.client.auditLog.create({ data: { actorId, action, subjectType, subjectId } })).rejects.toThrow();
  });

  it("commits one conflicting choice and audit across two sessions of the same member", async () => {
    const a = await user();
    await user();
    const second = await newSession(a);
    const [firstHandle, secondHandle] = await Promise.all([recommendation(a), recommendation(second)]);
    const outcomes = await Promise.all([decide(a, firstHandle, "ACCEPT"), decide(second, secondHandle, "DECLINE")]);
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual([200, 409]);
    const choice = outcomes[0].status === 200 ? "ACCEPT" : "DECLINE";
    expect(await outcomes.find(outcome => outcome.ok)!.json()).toEqual({ choice, mutual: false });
    expect(await outcomes.find(outcome => !outcome.ok)!.json()).toMatchObject({ code: "MATCH_DECISION_CONFLICT" });
    expect(await db.client.matchPair.count()).toBe(1);
    const rows = await db.client.matchDecision.findMany();
    expect(rows).toEqual([expect.objectContaining({ actorUserId: a.id, choice })]);
    expect(await db.client.auditLog.findMany({ where: { action: "MATCH_DECISION_RECORDED" } })).toEqual([
      expect.objectContaining({ subjectId: rows[0].id }),
    ]);
  });

  it("does not invalidate decisions on changes to other consent purposes", async () => {
    const a = await user();
    const b = await user();
    const handle = await recommendation(a);
    await consent(b, false, 1, "VIDEO_CLAIM_MATCHING");
    expect((await decide(a, handle)).status).toBe(200);
    await consent(a, false, 1, "REPORT_SHARING");
    expect((await decide(a, handle)).status).toBe(200);
    expect(await db.client.auditLog.count({ where: { action: "MATCH_DECISION_RECORDED" } })).toBe(1);
  });

  it("never reuses references across withdrawal/regrant or block/unblock before any decision", async () => {
    const a = await user();
    const b = await user();
    const beforeConsent = await recommendation(a);
    await consent(b, false, 1);
    expect((await decide(a, beforeConsent)).status).toBe(404);
    expect(await (await api("matches/recommendations", b)).json()).toEqual({
      available: false, recommendations: [], nextCursor: null,
    });
    await consent(b, true, 2);
    expect((await decide(a, beforeConsent)).status).toBe(404);
    const beforeBlock = await recommendation(a);
    expect((await api("blocks", b, json("POST", { targetUserId: a.id }))).status).toBe(204);
    expect((await decide(a, beforeBlock)).status).toBe(404);
    expect((await api(`blocks/${a.id}`, b, json("DELETE", {}))).status).toBe(204);
    expect((await decide(a, beforeBlock)).status).toBe(404);
    expect(await db.client.matchPair.count()).toBe(0);
    expect((await decide(a, await recommendation(a))).status).toBe(200);
  });

  it("does not issue a cursor based on blocked or otherwise screened-out accounts", async () => {
    const a = await user();
    const eligible = await user();
    const blocked = await user();
    expect((await api("blocks", blocked, json("POST", { targetUserId: a.id }))).status).toBe(204);
    for (let index = 0; index < 17; index++) {
      const peer = await user();
      await db.client.matchPreference.create({ data: { userId: peer.id, minAge: 119 } });
    }
    const response = await api("matches/recommendations", a);
    const body = await response.json();
    expect(body).toEqual({ available: true, nextCursor: null, recommendations: [{
      key: expect.any(String), pairId: expect.any(String), reasons: ["Meets both members’ matching settings."],
    }] });
    expect(JSON.stringify(body)).not.toContain(eligible.id);
  });

  it("applies each viewer's priority order without exposing ranks or profile fields", async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    for (const member of [a, c]) {
      await db.client.profile.update({ where: { userId: member.id }, data: {
        values: ["honesty"], interests: ["music"], relationshipGoal: "exploring", city: "PRIVATE_CITY",
      } });
    }
    await db.client.matchPreference.create({ data: { userId: a.id, relationshipGoal: "long-term" } });
    const session = await db.client.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(a.token) }, include: { user: true },
    });
    async function orderedPeers() {
      const response = await api("matches/recommendations", a);
      const body = await response.json() as { recommendations: { pairId: string; reasons: string[]; key: string }[] };
      expect(JSON.stringify(body)).not.toMatch(/PRIVATE_CITY|PRIVATE_BIO|long-term|honesty|Private Name/);
      expect(body.recommendations).toHaveLength(2);
      return body.recommendations.map(row => {
        expect(Object.keys(row).sort()).toEqual(["key", "pairId", "reasons"]);
        return app.get(MatchingHandles).read({ sessionId: session.id, user: session.user }, "decision", row.pairId)?.id;
      });
    }
    expect(await orderedPeers()).toEqual([b.id, c.id]);
    await db.client.matchPreference.update({ where: { userId: a.id }, data: { priorities: ["values", "relationship-goal"] } });
    expect(await orderedPeers()).toEqual([c.id, b.id]);
  });

  it("keeps legacy pairs unavailable and suppresses foreign choices and private snapshots", async () => {
    const a = await user();
    const b = await user();
    const legacyActor = await user("MEMBER", false);
    const handle = await recommendation(a);
    const [low, high] = [a.id, b.id].sort();
    await db.client.$transaction(async tx => {
      // Seed the exact shape an upgrade preserves, inside this disposable schema only.
      await tx.$executeRaw`ALTER TABLE "MatchPair" DISABLE TRIGGER "MatchPair_identity_guard"`;
      await tx.$executeRaw`ALTER TABLE "MatchDecision" DISABLE TRIGGER "MatchDecision_actor_guard"`;
      await tx.$executeRaw`INSERT INTO "MatchPair" (id, "userLowId", "userHighId", reasons)
        VALUES ('historical-pair', ${high}, ${low}, '{"private":"LEGACY_SNAPSHOT"}'::jsonb)`;
      await tx.$executeRaw`INSERT INTO "MatchDecision" (id, "pairId", "actorUserId", choice)
        VALUES ('old-choice', 'historical-pair', ${a.id}, 'ACCEPT'),
        ('foreign-choice', 'historical-pair', ${legacyActor.id}, 'ACCEPT')`;
      await tx.$executeRaw`ALTER TABLE "MatchDecision" ENABLE TRIGGER "MatchDecision_actor_guard"`;
      await tx.$executeRaw`ALTER TABLE "MatchPair" ENABLE TRIGGER "MatchPair_identity_guard"`;
    });
    expect((await decide(a, handle)).status).toBe(404);
    expect(await (await api("matches/recommendations", a)).json()).toEqual({
      available: true, recommendations: [], nextCursor: null,
    });
    const history = await decisions(a);
    expect(history).toEqual([{
      id: expect.stringMatching(/^[0-9a-f]{64}$/), choice: "ACCEPT", createdAt: expect.any(String), available: false, mutual: false,
    }]);
    expect(JSON.stringify(history)).not.toMatch(/old-choice|historical-pair|LEGACY_SNAPSHOT/);
    expect(await decisions(legacyActor)).toEqual([]);
  });

  it("keeps a concurrent accept and decline private and never reports a mutual match", async () => {
    const a = await user();
    const b = await user();
    const [aHandle, bHandle] = await Promise.all([recommendation(a), recommendation(b)]);
    const [accept, decline] = await Promise.all([decide(a, aHandle), decide(b, bHandle, "DECLINE")]);
    expect([accept.status, decline.status]).toEqual([200, 200]);
    expect(await accept.json()).toEqual({ choice: "ACCEPT", mutual: false });
    expect(await decline.json()).toEqual({ choice: "DECLINE", mutual: false });
    expect(await db.client.matchPair.count()).toBe(1);
    expect(await decisions(a)).toEqual([expect.objectContaining({ choice: "ACCEPT", mutual: false })]);
  });

  it("paginates both lists with actor-bound cursor scopes", async () => {
    const a = await user();
    const peers: Actor[] = [];
    for (let index = 0; index < 21; index++) peers.push(await user());
    type Page = { recommendations: { key: string; pairId: string }[]; nextCursor: string | null };
    const discovery = async (after?: string) => {
      const response = await api("matches/recommendations" + (after ? "?after=" + after : ""), a);
      expect(response.status).toBe(200);
      return await response.json() as Page;
    };
    const first = await discovery();
    expect(first.recommendations).toHaveLength(16);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect((await api("matches/recommendations?after=" + first.nextCursor, peers[0])).status).toBe(400);
    expect((await api("matches/decisions?after=" + first.nextCursor, a)).status).toBe(400);
    const second = await discovery(first.nextCursor!);
    expect(second.recommendations).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const all = [...first.recommendations, ...second.recommendations];
    expect(new Set(all.map(row => row.key)).size).toBe(21);
    for (const row of all) expect((await decide(a, row.pairId, "DECLINE")).status).toBe(200);
    const history = await (await api("matches/decisions", a)).json() as { decisions: unknown[]; nextCursor: string };
    expect(history.decisions).toHaveLength(20);
    expect(history.nextCursor).toEqual(expect.any(String));
    const older = await (await api("matches/decisions?after=" + history.nextCursor, a)).json();
    expect(older).toMatchObject({ decisions: [expect.objectContaining({ choice: "DECLINE", mutual: false })], nextCursor: null });
    expect(await decisions(peers[0])).toEqual([]);
  });

  it("rejects stale decisions after block or consent withdrawal and never revives an old mutual state", async () => {
    const a = await user();
    const b = await user();
    const aHandle = await recommendation(a);
    const bHandle = await recommendation(b);
    await decide(a, aHandle);
    expect((await api("blocks", b, json("POST", { targetUserId: a.id }))).status).toBe(204);
    expect((await decide(b, bHandle)).status).toBe(404);
    expect((await api(`blocks/${a.id}`, b, json("DELETE", {}))).status).toBe(204);
    expect((await decide(b, bHandle)).status).toBe(404);
    expect((await decisions(a))[0]).toMatchObject({ available: false, mutual: false });

    const c = await user();
    await db.client.profile.update({ where: { userId: b.id }, data: { visibilityEnabled: false } });
    const cHandle = await recommendation(c);
    const newAHandle = await recommendation(a);
    await decide(c, cHandle);
    await decide(a, newAHandle);
    await consent(c, false, 1);
    expect((await decide(a, newAHandle)).status).toBe(404);
    await consent(c, true, 2);
    expect((await decisions(c))[0]).toMatchObject({ available: false, mutual: false });
    expect((await decisions(a)).every((row: { mutual: boolean }) => !row.mutual)).toBe(true);
  });

  describe.each([
    [Prisma.TransactionIsolationLevel.ReadCommitted, "read committed"],
    [Prisma.TransactionIsolationLevel.RepeatableRead, "repeatable read"],
  ] as const)("matching with %s as the client default", (isolationLevel, expectedIsolation) => {
    it.each([
      ["read", "consent"], ["write", "consent"], ["read", "block"], ["write", "block"],
    ] as const)("rechecks a waiting %s after a committed %s change", async (operation, restriction) => {
      await app.close();
      configuredClient = new PrismaClient({
        datasources: { db: { url: db.url } }, transactionOptions: { isolationLevel },
      });
      const [level] = await configuredClient.$transaction(tx =>
        tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`);
      expect(level.transaction_isolation).toBe(expectedIsolation);
      await startApi(configuredClient);
      const a = await user();
      const b = await user();
      const handle = await recommendation(a);

      let result!: Promise<Response>;
      await db.client.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${a.id}, ${b.id}) ORDER BY id FOR UPDATE`;
        const [writer] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        result = operation === "write" ? decide(a, handle) : api("matches/recommendations", a);
        const deadline = Date.now() + 2500;
        let waiting = false;
        while (!waiting && Date.now() < deadline) {
          const [row] = await db.client.$queryRaw<{ waiting: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock'
            AND query LIKE '%ORDER BY id FOR UPDATE%' AND ${writer.pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
          waiting = row.waiting;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 30));
        }
        expect(waiting).toBe(true);
        // Change the live eligibility row without modifying the participant lock row.
        if (restriction === "block") {
          await tx.block.create({ data: { blockerId: b.id, blockedId: a.id } });
        } else {
          await tx.consent.update({
            where: { userId_purpose: { userId: b.id, purpose: "PROFILE_MATCHING" } },
            data: { granted: false, revokedAt: new Date() },
          });
        }
      });
      const response = await result;
      if (operation === "write") {
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "MATCH_UNAVAILABLE" });
      } else {
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ available: true, recommendations: [], nextCursor: null });
      }
      expect(await db.client.matchPair.count()).toBe(0);
      expect(await db.client.matchDecision.count()).toBe(0);
      expect(await db.client.auditLog.count({ where: { action: "MATCH_DECISION_RECORDED" } })).toBe(0);
    });
  });

  it("rolls back a new decision and pair if the audit insert fails", async () => {
    const a = await user();
    await user();
    const handle = await recommendation(a);
    await db.client.$executeRawUnsafe(`
      CREATE FUNCTION reject_matching_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`);
    await db.client.$executeRawUnsafe(`
      CREATE TRIGGER "reject_matching_audit" BEFORE INSERT ON "AuditLog"
      FOR EACH ROW WHEN (NEW.action = 'MATCH_DECISION_RECORDED') EXECUTE FUNCTION reject_matching_audit()`);
    expect((await decide(a, handle)).status).toBe(503);
    expect(await db.client.matchPair.count()).toBe(0);
    expect(await db.client.matchDecision.count()).toBe(0);
  });
});
