import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomBytes, randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/configure-app";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { PrismaService } from "../src/database/prisma.service";
import { hashSessionToken } from "../src/auth/session-token";
import { createAuthDatabase } from "./disposable-auth-database";
import { BlockAccessService } from "../src/safety/block-access.service";
import { BlockService } from "../src/safety/block.service";
import { lockSafetyUsers } from "../src/safety/safety-access.service";

describe("Safety API / real sessions / isolated PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>,
    app: INestApplication,
    base: string;
  const origin = "http://localhost:3000";
  beforeAll(async () => {
    db = await createAuthDatabase();
  }, 60000);
  beforeEach(async () => {
    const values = parseEnvironment({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: db.url,
      CORS_ORIGIN: origin,
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EnvironmentService)
      .useValue({ values })
      .overrideProvider(PrismaService)
      .useValue(db.client)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterEach(async () => {
    await app?.close();
  });
  afterAll(async () => {
    await db?.close();
  });
  async function account(role: UserRole = "MEMBER") {
    const token = randomBytes(32).toString("base64url");
    const row = await db.client.user.create({
      data: {
        email: randomUUID() + "@example.invalid",
        passwordHash: "synthetic-only",
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        sessions: {
          create: {
            tokenHash: hashSessionToken(token),
            expiresAt: new Date(Date.now() + 600000),
          },
        },
      },
      include: { sessions: { select: { id: true } } },
    });
    return {
      id: row.id,
      cookie:
        app.get(EnvironmentService).values.session.cookieName + "=" + token,
      auth: {
        sessionId: row.sessions[0].id,
        user: {
          id: row.id,
          email: row.email,
          displayName: row.displayName,
          role: row.role,
        },
      },
    };
  }
  const request = (
    cookie: string,
    path: string,
    method = "GET",
    body: unknown = {},
    headers: Record<string, string> = {},
  ) =>
    fetch(base + "/api/" + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
  it("creates one own block and atomic audit despite concurrent duplicates; hides unrelated metadata", async () => {
    const a = await account(),
      b = await account();
    const results = await Promise.all([
      request(a.cookie, "blocks", "POST", { targetUserId: b.id }),
      request(a.cookie, "blocks", "POST", { targetUserId: b.id }),
    ]);
    expect(results.map((r) => r.status)).toEqual([204, 204]);
    expect(
      await db.client.block.count({
        where: { blockerId: a.id, blockedId: b.id },
      }),
    ).toBe(1);
    const row = await db.client.block.findUniqueOrThrow({
      where: { blockerId_blockedId: { blockerId: a.id, blockedId: b.id } },
    });
    expect(
      await db.client.auditLog.count({
        where: { action: "SAFETY_BLOCK_CREATED", subjectId: row.id },
      }),
    ).toBe(1);
    const response = await request(a.cookie, "blocks/me");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const list = (await response.json()) as {
      blocks: { targetUserId: string }[];
      nextCursor: null;
    };
    expect(list.blocks.map((b) => b.targetUserId)).toEqual([b.id]);
    expect(list.nextCursor).toBeNull();
    expect(JSON.stringify(list)).not.toMatch(
      /email|password|token|blockerId|displayName/,
    );
    expect(await (await request(b.cookie, "blocks/me")).json()).toEqual({
      blocks: [],
      nextCursor: null,
    });
  });
  it("excludes both directions through the shared rule and never unblocks another owner's edge", async () => {
    const a = await account(),
      b = await account(),
      rule = app.get(BlockAccessService);
    await request(a.cookie, "blocks", "POST", { targetUserId: b.id });
    for (const [left, right] of [
      [a.id, b.id],
      [b.id, a.id],
    ])
      await expect(
        db.client.$transaction((tx) => rule.assertClear(tx, left, right)),
      ).rejects.toMatchObject({ status: 403 });
    const excluded = await db.client.$transaction((tx) =>
      rule.excludedPeers(tx, b.id),
    );
    expect(excluded.has(a.id)).toBe(true);
    expect((await request(b.cookie, "blocks/" + a.id, "DELETE")).status).toBe(
      204,
    );
    expect(
      await db.client.block.count({
        where: { blockerId: a.id, blockedId: b.id },
      }),
    ).toBe(1);
    expect(
      (await request(a.cookie, "blocks/" + b.id, "DELETE", { blockerId: b.id }))
        .status,
    ).toBe(400);
    expect((await request(a.cookie, "blocks/" + b.id, "DELETE")).status).toBe(
      204,
    );
    await expect(
      db.client.$transaction((tx) => rule.assertClear(tx, b.id, a.id)),
    ).resolves.toBeUndefined();
  });
  it("rejects forged owners, self-blocks, unavailable references and unsafe requests", async () => {
    const a = await account(),
      b = await account();
    expect(
      (await request(a.cookie, "blocks", "POST", { targetUserId: a.id }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(a.cookie, "blocks", "POST", {
          targetUserId: b.id,
          blockerId: b.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(a.cookie, "blocks", "POST", { targetUserId: "missing" }))
        .status,
    ).toBe(404);
    expect(
      (
        await request(
          a.cookie,
          "blocks",
          "POST",
          { targetUserId: b.id },
          { Origin: "https://evil.invalid" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          a.cookie,
          "blocks",
          "POST",
          { targetUserId: b.id },
          { "sec-fetch-site": "cross-site" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          a.cookie,
          "blocks",
          "POST",
          { targetUserId: b.id },
          { "Content-Type": "text/plain" },
        )
      ).status,
    ).toBe(415);
    expect((await request(a.cookie, "blocks/me?ownerId=" + b.id)).status).toBe(
      400,
    );
  });
  it("requires active verified member sessions and rechecks service authorization", async () => {
    const b = await account();
    expect((await request("", "blocks/me")).status).toBe(401);
    for (const role of ["EXPERT", "MODERATOR", "ADMIN"] as const) {
      const staff = await account(role);
      expect(
        (await request(staff.cookie, "blocks", "POST", { targetUserId: b.id }))
          .status,
      ).toBe(403);
    }
    const a = await account();
    await db.client.session.update({
      where: { id: a.auth.sessionId },
      data: { revokedAt: new Date() },
    });
    expect((await request(a.cookie, "blocks/me")).status).toBe(401);
    await expect(
      app.get(BlockService).block(a.auth, { targetUserId: b.id }),
    ).rejects.toMatchObject({ status: 401 });
    const c = await account();
    await db.client.user.update({
      where: { id: c.id },
      data: { role: "ADMIN" },
    });
    await expect(
      app.get(BlockService).block(c.auth, { targetUserId: b.id }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("serializes a consumer check with block creation using sorted User locks", async () => {
    const a = await account(),
      b = await account(),
      rule = app.get(BlockAccessService);
    let enter!: () => void, release!: () => void;
    const started = new Promise<void>((r) => (enter = r)),
      gate = new Promise<void>((r) => (release = r));
    const read = db.client.$transaction(async (tx) => {
      await lockSafetyUsers(tx, [a.id, b.id]);
      await rule.assertClear(tx, a.id, b.id);
      enter();
      await gate;
    });
    await started;
    const blocking = request(b.cookie, "blocks", "POST", {
      targetUserId: a.id,
    });
    release();
    await read;
    expect((await blocking).status).toBe(204);
    await expect(
      db.client.$transaction((tx) => rule.assertClear(tx, a.id, b.id)),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rolls back a block when audit persistence fails", async () => {
    const a = await account(),
      b = await account();
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION safety_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$`,
    );
    await db.client.$executeRawUnsafe(
      'CREATE TRIGGER safety_test_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION safety_test_audit_failure()',
    );
    try {
      expect(
        (await request(a.cookie, "blocks", "POST", { targetUserId: b.id }))
          .status,
      ).toBe(503);
      expect(await db.client.block.count({ where: { blockerId: a.id } })).toBe(
        0,
      );
    } finally {
      await db.client.$executeRawUnsafe(
        'DROP TRIGGER safety_test_audit_failure ON "AuditLog"',
      );
      await db.client.$executeRawUnsafe(
        "DROP FUNCTION safety_test_audit_failure()",
      );
    }
  });
  it("paginates more than fifty own blocks without leaking inbound restrictions", async () => {
    const a = await account();
    const ids = Array.from({ length: 55 }, () => randomUUID());
    await db.client.user.createMany({
      data: ids.map((id) => ({
        id,
        email: id + "@example.invalid",
        passwordHash: "synthetic",
      })),
    });
    await db.client.block.createMany({
      data: ids.map((blockedId) => ({ blockerId: a.id, blockedId })),
    });
    const first = (await (await request(a.cookie, "blocks/me")).json()) as {
      blocks: { targetUserId: string }[];
      nextCursor: string;
    };
    expect(first.blocks).toHaveLength(50);
    const next = (await (
      await request(a.cookie, "blocks/me?cursor=" + first.nextCursor)
    ).json()) as { blocks: { targetUserId: string }[]; nextCursor: null };
    expect(next.blocks).toHaveLength(5);
    expect(next.nextCursor).toBeNull();
    expect(
      new Set([...first.blocks, ...next.blocks].map((r) => r.targetUserId))
        .size,
    ).toBe(55);
  });
});
