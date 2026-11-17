import { randomUUID } from "node:crypto";
import { createAuthDatabase } from "./disposable-auth-database";
import { createExpertUpgradeDatabase } from "./expert-db-fixtures";

describe("C061 safety database / isolated PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>;
  beforeAll(async () => {
    db = await createAuthDatabase();
  }, 60000);
  afterAll(async () => {
    await db?.close();
  });
  const user = () =>
    db.client.user.create({
      data: {
        email: randomUUID() + "@example.invalid",
        passwordHash: "synthetic-only",
      },
    });
  it("enforces real users, unique directional blocks and no self-block", async () => {
    const a = await user(),
      b = await user();
    await db.client.block.create({
      data: { blockerId: a.id, blockedId: b.id },
    });
    await expect(
      db.client.block.create({ data: { blockerId: a.id, blockedId: b.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      db.client.block.create({
        data: { blockerId: a.id, blockedId: "missing" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.client.block.create({ data: { blockerId: a.id, blockedId: a.id } }),
    ).rejects.toThrow();
    await db.client.block.create({
      data: { blockerId: b.id, blockedId: a.id },
    });
  });
  it("retains report content and immutable moderator evidence after user mapping deletion", async () => {
    const a = await user(),
      b = await user(),
      staff = await user();
    const report = await db.client.report.create({
      data: {
        reporterId: a.id,
        targetUserId: b.id,
        reason: "SYNTHETIC private report",
        reasonCode: "SPAM",
      },
    });
    const action = await db.client.$transaction(async (tx) => {
      await tx.report.update({
        where: { id: report.id },
        data: { status: "IN_REVIEW", revision: 1n, moderatorId: staff.id },
      });
      return tx.reportModerationAction.create({
        data: {
          reportId: report.id,
          revision: 1n,
          fromStatus: "OPEN",
          toStatus: "IN_REVIEW",
          actorEvidence: { subject: randomUUID() },
          createdAt: new Date(0),
        },
      });
    });
    expect(action.createdAt.getTime()).toBeGreaterThan(0);
    await expect(
      db.client.reportModerationAction.update({
        where: { id: action.id },
        data: { toStatus: "DISMISSED" },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.reportModerationAction.delete({ where: { id: action.id } }),
    ).rejects.toThrow();
    await expect(
      db.client.$executeRawUnsafe('TRUNCATE "ReportModerationAction"'),
    ).rejects.toThrow();
    await expect(
      db.client.report.delete({ where: { id: report.id } }),
    ).rejects.toThrow();
    await db.client.user.deleteMany({
      where: { id: { in: [a.id, b.id, staff.id] } },
    });
    expect(
      await db.client.report.findUnique({ where: { id: report.id } }),
    ).toMatchObject({
      reporterId: null,
      targetUserId: null,
      moderatorId: null,
      reason: "SYNTHETIC private report",
    });
    expect(
      await db.client.reportModerationAction.findUnique({
        where: { id: action.id },
      }),
    ).toEqual(action);
  });
  it("protects safety audit updates/deletion/truncation and requires complete actor evidence", async () => {
    const audit = await db.client.auditLog.create({
      data: { action: "SAFETY_REPORT_SUBMITTED", subjectType: "Report" },
    });
    await expect(
      db.client.auditLog.update({
        where: { id: audit.id },
        data: { action: "OTHER" },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.auditLog.delete({ where: { id: audit.id } }),
    ).rejects.toThrow();
    await expect(
      db.client.$executeRawUnsafe('TRUNCATE "AuditLog"'),
    ).rejects.toThrow();
    const a = await user(),
      b = await user();
    const r = await db.client.report.create({
      data: { reporterId: a.id, targetUserId: b.id, reason: "synthetic" },
    });
    await expect(
      db.client.reportModerationAction.create({
        data: {
          reportId: r.id,
          revision: 1n,
          fromStatus: "OPEN",
          toStatus: "IN_REVIEW",
          actorEvidence: {},
        },
      }),
    ).rejects.toThrow();
  });
  it("upgrades legacy reports without inventing a reason classification or losing content", async () => {
    const legacy = await createExpertUpgradeDatabase();
    try {
      const a = await legacy.client.user.create({
        data: {
          email: randomUUID() + "@example.invalid",
          passwordHash: "synthetic",
        },
      });
      const b = await legacy.client.user.create({
        data: {
          email: randomUUID() + "@example.invalid",
          passwordHash: "synthetic",
        },
      });
      await legacy.client.$executeRawUnsafe(
        'INSERT INTO "Block" (id,"blockerId","blockedId") VALUES ($1,$2,$3)',
        "legacy-block",
        a.id,
        b.id,
      );
      await legacy.client.$executeRawUnsafe(
        'INSERT INTO "Report" (id,"reporterId","targetUserId",reason,"updatedAt") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)',
        "legacy-report",
        a.id,
        b.id,
        "SYNTHETIC legacy content",
      );
      legacy.deploy();
      expect(
        await legacy.client.report.findUnique({
          where: { id: "legacy-report" },
        }),
      ).toMatchObject({
        reason: "SYNTHETIC legacy content",
        reasonCode: null,
        revision: 0n,
        status: "OPEN",
      });
      expect(await legacy.client.block.count()).toBe(1);
    } finally {
      await legacy.close();
    }
  }, 60000);
});
