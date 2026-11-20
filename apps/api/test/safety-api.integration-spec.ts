import { StaffAssuranceSource } from "../src/safety/staff-assurance.source";
import { ModerationService } from "../src/safety/moderation.service";
import { AssignmentQueuesService } from "../src/expert-admin/assignment-queues.service";
import { AssignmentGrantsService } from "../src/expert-admin/assignment-grants.service";
import { SafetyRateLimiter } from "../src/safety/safety-request.guard";
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
  it("shares one default-deny assurance provider across Safety and PA2 services", async () => {
    const source = app.get(StaffAssuranceSource);
    for (const service of [app.get(ModerationService), app.get(AssignmentQueuesService), app.get(AssignmentGrantsService)]) {
      expect(Reflect.get(service, "assurance")).toBe(source);
    }
    const moderator = await account("MODERATOR");
    await expect(source.resolve(db.client, moderator.auth)).resolves.toBeUndefined();
    const proof = staffProof();
    try {
      for (const service of [app.get(ModerationService), app.get(AssignmentQueuesService), app.get(AssignmentGrantsService)]) {
        const injected = Reflect.get(service, "assurance") as StaffAssuranceSource;
        await expect(injected.resolve(db.client, moderator.auth)).resolves.toMatchObject({
          userId: moderator.id, sessionId: moderator.auth.sessionId, level: "MFA", testOnly: true,
        });
      }
    } finally {
      proof.mockRestore();
    }
    await expect(source.resolve(db.client, moderator.auth)).resolves.toBeUndefined();
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

  it("stores bounded private reports and returns identical generic acknowledgements for unavailable targets", async () => {
    const a = await account(),
      b = await account();
    const body = {
      targetUserId: b.id,
      reason: "HARASSMENT",
      details: "SYNTHETIC private report details",
    };
    const sent = await request(a.cookie, "reports", "POST", body);
    expect(sent.status).toBe(202);
    const acknowledgement = await sent.json();
    expect(acknowledgement).toEqual({
      message: "Your report request was received.",
    });
    expect(
      await db.client.report.findFirst({
        where: { reporterId: a.id, targetUserId: b.id },
      }),
    ).toMatchObject({
      reason: body.details,
      reasonCode: "HARASSMENT",
      status: "OPEN",
      revision: 0n,
      moderatorId: null,
    });
    expect(JSON.stringify(acknowledgement)).not.toMatch(
      /details|reporter|target|status|id/,
    );
    const unavailable = await request(a.cookie, "reports", "POST", {
      ...body,
      targetUserId: "unknown-account",
    });
    expect(unavailable.status).toBe(202);
    expect(await unavailable.json()).toEqual(acknowledgement);
    await db.client.user.update({
      where: { id: b.id },
      data: { status: "SUSPENDED" },
    });
    expect(
      await (await request(a.cookie, "reports", "POST", body)).json(),
    ).toEqual(acknowledgement);
    expect(await db.client.report.count({ where: { reporterId: a.id } })).toBe(
      1,
    );
  });
  it("keeps reporting available after blocking, rejects impersonation and never echoes evidence", async () => {
    const a = await account(),
      b = await account();
    await request(a.cookie, "blocks", "POST", { targetUserId: b.id });
    const body = {
      targetUserId: b.id,
      reason: "SPAM",
      details: "SYNTHETIC <script>untrusted evidence</script>",
    };
    expect(
      (
        await request(a.cookie, "reports", "POST", {
          ...body,
          reporterId: b.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(a.cookie, "reports", "POST", {
          ...body,
          targetUserId: a.id,
        })
      ).status,
    ).toBe(400);
    expect((await request("", "reports", "POST", body)).status).toBe(401);
    const result = await request(a.cookie, "reports", "POST", body);
    expect(result.status).toBe(202);
    const r = await db.client.report.findFirstOrThrow({
      where: { reporterId: a.id },
    });
    expect(r.reason).toBe(body.details);
    const audit = await db.client.auditLog.findFirstOrThrow({
      where: { action: "SAFETY_REPORT_SUBMITTED", subjectId: r.id },
    });
    expect(JSON.stringify(audit)).not.toMatch(
      /script|untrusted|SPAM|passwordHash/,
    );
  });
  it("returns Retry-After without consuming independent unblock capacity", async () => {
    const a = await account(),
      b = await account();
    await request(a.cookie, "blocks", "POST", { targetUserId: b.id });
    const limiter = app.get(SafetyRateLimiter);
    for (let i = 0; i < 5; i++)
      limiter.consume("safety:submitReport", a.id, 5, 60000);
    const response = await request(a.cookie, "reports", "POST", {
      targetUserId: b.id,
      reason: "OTHER",
      details: "SYNTHETIC bounded details",
    });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await request(a.cookie, "blocks/" + b.id, "DELETE")).status).toBe(
      204,
    );
    expect(await db.client.report.count({ where: { reporterId: a.id } })).toBe(
      0,
    );
  });
  it("rolls back report creation if the atomic safety audit fails", async () => {
    const a = await account(),
      b = await account();
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION safety_test_report_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic report audit failure'; END $$`,
    );
    await db.client.$executeRawUnsafe(
      'CREATE TRIGGER safety_test_report_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION safety_test_report_failure()',
    );
    try {
      expect(
        (
          await request(a.cookie, "reports", "POST", {
            targetUserId: b.id,
            reason: "OTHER",
            details: "SYNTHETIC private details",
          })
        ).status,
      ).toBe(503);
      expect(
        await db.client.report.count({ where: { reporterId: a.id } }),
      ).toBe(0);
    } finally {
      await db.client.$executeRawUnsafe(
        'DROP TRIGGER safety_test_report_failure ON "AuditLog"',
      );
      await db.client.$executeRawUnsafe(
        "DROP FUNCTION safety_test_report_failure()",
      );
    }
  });

  function staffProof() {
    return jest
      .spyOn(app.get(StaffAssuranceSource), "resolve")
      .mockImplementation(async (_tx, auth) => ({
        userId: auth.user.id,
        sessionId: auth.sessionId,
        level: "MFA",
        verifiedAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 60000),
        testOnly: true,
      }));
  }
  async function caseReport(targetId?: string) {
    const reporter = await account(),
      target = targetId ?? (await account()).id;
    expect(
      (
        await request(reporter.cookie, "reports", "POST", {
          targetUserId: target,
          reason: "HARASSMENT",
          details: "SYNTHETIC <script>private evidence</script>",
        })
      ).status,
    ).toBe(202);
    return db.client.report.findFirstOrThrow({
      where: { reporterId: reporter.id, targetUserId: target },
    });
  }
  it("denies report access to guests, members, experts, ADMIN and moderators without real assurance", async () => {
    const report = await caseReport();
    expect((await request("", "moderation/reports")).status).toBe(401);
    for (const role of ["MEMBER", "EXPERT", "ADMIN", "MODERATOR"] as const) {
      const actor = await account(role);
      expect((await request(actor.cookie, "moderation/reports")).status).toBe(
        403,
      );
      expect(
        (await request(actor.cookie, "moderation/reports/" + report.id)).status,
      ).toBe(403);
      expect(
        (
          await request(
            actor.cookie,
            "moderation/reports/" + report.id,
            "PATCH",
            { status: "IN_REVIEW", expectedRevision: 0 },
          )
        ).status,
      ).toBe(403);
    }
    expect(
      await db.client.reportModerationAction.count({
        where: { reportId: report.id },
      }),
    ).toBe(0);
  });
  it("exposes only scoped queue metadata, requires claiming for details and audits every read/change", async () => {
    const proof = staffProof();
    try {
      const mod = await account("MODERATOR"),
        other = await account("MODERATOR"),
        report = await caseReport();
      const queue = await request(mod.cookie, "moderation/reports");
      expect(queue.status).toBe(200);
      expect(queue.headers.get("cache-control")).toContain("no-store");
      const json = (await queue.json()) as { reports: { id: string }[] };
      expect(json.reports.some((r) => r.id === report.id)).toBe(true);
      expect(JSON.stringify(json)).not.toMatch(
        /private evidence|script|reporterId|targetUserId|objectKey|bucket|passwordHash/,
      );
      expect(
        (await request(mod.cookie, "moderation/reports/" + report.id)).status,
      ).toBe(404);
      const claim = await request(
        mod.cookie,
        "moderation/reports/" + report.id,
        "PATCH",
        { status: "IN_REVIEW", expectedRevision: 0 },
      );
      expect(claim.status).toBe(200);
      const detail = await request(
        mod.cookie,
        "moderation/reports/" + report.id,
      );
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({
        report: { details: report.reason, status: "IN_REVIEW", revision: 1 },
      });
      expect(
        (await request(other.cookie, "moderation/reports/" + report.id)).status,
      ).toBe(404);
      const otherQueue = (await (
        await request(other.cookie, "moderation/reports")
      ).json()) as { reports: { id: string }[] };
      expect(otherQueue.reports.some((r) => r.id === report.id)).toBe(false);
      expect(
        (
          await request(
            mod.cookie,
            "moderation/reports/" + report.id,
            "PATCH",
            { status: "RESOLVED", expectedRevision: 1 },
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            mod.cookie,
            "moderation/reports/" + report.id,
            "PATCH",
            { status: "IN_REVIEW", expectedRevision: 2 },
          )
        ).status,
      ).toBe(409);
      const actions = await db.client.reportModerationAction.findMany({
        where: { reportId: report.id },
        orderBy: { revision: "asc" },
      });
      expect(
        actions.map((a) => [a.fromStatus, a.toStatus, a.revision]),
      ).toEqual([
        ["OPEN", "IN_REVIEW", 1n],
        ["IN_REVIEW", "RESOLVED", 2n],
      ]);
      expect(actions[0].actorEvidence).toEqual({
        subject: (
          await db.client.expertActorIdentity.findUniqueOrThrow({
            where: { userId: mod.id },
          })
        ).subjectId,
      });
      expect(
        (
          await db.client.user.findUniqueOrThrow({
            where: { id: report.targetUserId! },
          })
        ).status,
      ).toBe("ACTIVE");
      const audit = await db.client.auditLog.findMany({
        where: { actorId: mod.id, action: { startsWith: "SAFETY_REPORT_" } },
      });
      expect(audit.some((a) => a.action === "SAFETY_REPORT_VIEWED")).toBe(true);
      expect(JSON.stringify(audit)).not.toContain("private evidence");
    } finally {
      proof.mockRestore();
    }
  });
  it("prevents self-case moderation and rejects stale, forged or invalid transitions", async () => {
    const proof = staffProof();
    try {
      const mod = await account("MODERATOR"),
        self = await caseReport(mod.id),
        report = await caseReport();
      expect(
        (
          await request(mod.cookie, "moderation/reports/" + self.id, "PATCH", {
            status: "IN_REVIEW",
            expectedRevision: 0,
          })
        ).status,
      ).toBe(404);
      for (const body of [
        { status: "RESOLVED", expectedRevision: 0 },
        { status: "IN_REVIEW", expectedRevision: 1 },
      ])
        expect(
          (
            await request(
              mod.cookie,
              "moderation/reports/" + report.id,
              "PATCH",
              body,
            )
          ).status,
        ).toBe(409);
      for (const body of [
        { status: "IN_REVIEW", expectedRevision: 0, moderatorId: "forged" },
        { status: "OPEN", expectedRevision: 0 },
        { status: "IN_REVIEW", expectedRevision: -1 },
      ])
        expect(
          (
            await request(
              mod.cookie,
              "moderation/reports/" + report.id,
              "PATCH",
              body,
            )
          ).status,
        ).toBe(400);
      expect(
        (await request(mod.cookie, "moderation/reports?status=UNKNOWN")).status,
      ).toBe(400);
      expect(
        (
          await request(
            mod.cookie,
            "moderation/reports/" + report.id + "?include=video",
          )
        ).status,
      ).toBe(400);
      expect(
        await db.client.reportModerationAction.count({
          where: { reportId: report.id },
        }),
      ).toBe(0);
    } finally {
      proof.mockRestore();
    }
  });
  it("serializes concurrent claims and same-moderator CAS without duplicate history", async () => {
    const proof = staffProof();
    try {
      const a = await account("MODERATOR"),
        b = await account("MODERATOR"),
        report = await caseReport();
      const claims = await Promise.all([
        request(a.cookie, "moderation/reports/" + report.id, "PATCH", {
          status: "IN_REVIEW",
          expectedRevision: 0,
        }),
        request(b.cookie, "moderation/reports/" + report.id, "PATCH", {
          status: "IN_REVIEW",
          expectedRevision: 0,
        }),
      ]);
      expect(claims.map((r) => r.status).sort()).toEqual([200, 404]);
      const actor = claims[0].status === 200 ? a : b;
      const finish = await Promise.all([
        request(actor.cookie, "moderation/reports/" + report.id, "PATCH", {
          status: "RESOLVED",
          expectedRevision: 1,
        }),
        request(actor.cookie, "moderation/reports/" + report.id, "PATCH", {
          status: "DISMISSED",
          expectedRevision: 1,
        }),
      ]);
      expect(finish.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await db.client.reportModerationAction.count({
          where: { reportId: report.id },
        }),
      ).toBe(2);
    } finally {
      proof.mockRestore();
    }
  });
  it("rejects expired/mismatched assurance and synthetic assurance outside test mode", async () => {
    const mod = await account("MODERATOR"),
      source = app.get(StaffAssuranceSource);
    for (const patch of [
      { userId: "other" },
      { sessionId: "other" },
      { verifiedAt: new Date("2099-01-01") },
      { expiresAt: new Date(0) },
    ]) {
      const proof = jest
        .spyOn(source, "resolve")
        .mockImplementation(async (_tx, auth) => ({
          userId: auth.user.id,
          sessionId: auth.sessionId,
          level: "MFA",
          verifiedAt: new Date(Date.now() - 1000),
          expiresAt: new Date(Date.now() + 60000),
          testOnly: true,
          ...patch,
        }));
      try {
        expect((await request(mod.cookie, "moderation/reports")).status).toBe(
          403,
        );
      } finally {
        proof.mockRestore();
      }
    }
    const proof = staffProof(),
      env = app.get(EnvironmentService),
      before = env.values;
    try {
      Object.defineProperty(env, "values", {
        value: { ...before, nodeEnv: "production" },
        configurable: true,
      });
      expect((await request(mod.cookie, "moderation/reports")).status).toBe(
        403,
      );
    } finally {
      Object.defineProperty(env, "values", {
        value: before,
        configurable: true,
      });
      proof.mockRestore();
    }
  });
  it("rolls back moderation revision, actor identity, action and status if final audit fails", async () => {
    const proof = staffProof();
    try {
      const mod = await account("MODERATOR"),
        report = await caseReport();
      await db.client.$executeRawUnsafe(
        `CREATE FUNCTION safety_test_mod_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic moderation audit failure'; END $$`,
      );
      await db.client.$executeRawUnsafe(
        'CREATE TRIGGER safety_test_mod_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION safety_test_mod_failure()',
      );
      try {
        expect(
          (
            await request(
              mod.cookie,
              "moderation/reports/" + report.id,
              "PATCH",
              { status: "IN_REVIEW", expectedRevision: 0 },
            )
          ).status,
        ).toBe(503);
      } finally {
        await db.client.$executeRawUnsafe(
          'DROP TRIGGER safety_test_mod_failure ON "AuditLog"',
        );
        await db.client.$executeRawUnsafe(
          "DROP FUNCTION safety_test_mod_failure()",
        );
      }
      expect(
        await db.client.report.findUnique({ where: { id: report.id } }),
      ).toMatchObject({ status: "OPEN", revision: 0n, moderatorId: null });
      expect(
        await db.client.reportModerationAction.count({
          where: { reportId: report.id },
        }),
      ).toBe(0);
      expect(
        await db.client.expertActorIdentity.findUnique({
          where: { userId: mod.id },
        }),
      ).toBeNull();
    } finally {
      proof.mockRestore();
    }
  });

  it("paginates the scoped moderation queue beyond fifty cases", async () => {
    const proof = staffProof();
    try {
      const mod = await account("MODERATOR"),
        a = await account(),
        b = await account(),
        ids = Array.from({ length: 55 }, () => randomUUID());
      await db.client.report.createMany({
        data: ids.map((id) => ({
          id,
          reporterId: a.id,
          targetUserId: b.id,
          reason: "SYNTHETIC pagination details",
          reasonCode: "SPAM" as const,
        })),
      });
      const first = (await (
        await request(mod.cookie, "moderation/reports?status=OPEN")
      ).json()) as { reports: { id: string }[]; nextCursor: string };
      expect(first.reports).toHaveLength(50);
      const second = (await (
        await request(
          mod.cookie,
          "moderation/reports?status=OPEN&cursor=" + first.nextCursor,
        )
      ).json()) as { reports: { id: string }[]; nextCursor: null };
      const found = new Set(
        [...first.reports, ...second.reports].map((r) => r.id),
      );
      for (const id of ids) expect(found.has(id)).toBe(true);
      expect(second.nextCursor).toBeNull();
    } finally {
      proof.mockRestore();
    }
  });
});
