import { randomUUID } from "node:crypto";
import { assignmentEvent, createExpertUpgradeDatabase, expectDatabaseError } from "./expert-db-fixtures";

async function legacy(db: Awaited<ReturnType<typeof createExpertUpgradeDatabase>>, orphan = false) {
  const id = randomUUID(), p = db.client;
  const expert = await p.user.create({ data: { email: `${id}@example.invalid`, passwordHash: "synthetic-only", role: "EXPERT" } });
  const moderator = await p.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-only", role: "MODERATOR" } });
  const video = await p.video.create({ data: { ownerId: expert.id, bucket: "synthetic-private", objectKey: id, mimeType: "video/mp4" } });
  const assignmentId = randomUUID();
  await p.$executeRaw`INSERT INTO "ExpertAssignment" (id,"videoId","expertId","assignedById","dueAt")
    VALUES (${assignmentId},${video.id},${expert.id},${orphan ? "missing-actor" : moderator.id},'2026-01-01'::timestamp)`;
  const review = await p.expertReview.create({ data: { assignmentId, summary: "Synthetic preserved review" } });
  return { expert, moderator, video, assignmentId, review };
}

describe("C031 additive migration upgrade", () => {
  it("preserves initial-migration data without fabricating approval or historical events", async () => {
    const db = await createExpertUpgradeDatabase();
    try {
      const seed = await legacy(db);
      const [before] = await db.client.$queryRaw<{ row: Record<string, unknown> }[]>`SELECT to_jsonb(a) AS row FROM "ExpertAssignment" a WHERE id=${seed.assignmentId}`;
      db.deploy();
      const [after] = await db.client.$queryRaw<{ row: Record<string, unknown> }[]>`SELECT to_jsonb(a) AS row FROM "ExpertAssignment" a WHERE id=${seed.assignmentId}`;
      expect(after.row).toMatchObject(before.row);
      expect(after.row).toMatchObject({ revision: 0, credentialApprovalId: null, expiresAt: null, eventTransactionId: null, eventFromStatus: null });
      const identity = await db.client.expertActorIdentity.findUniqueOrThrow({ where: { userId: seed.moderator.id } });
      expect(after.row.assignedByEvidence).toEqual({ subject: identity.subjectId, source: "LEGACY_ASSIGNED_BY_ID" });
      expect(await db.client.expertCredential.count()).toBe(0);
      expect(await db.client.expertCredentialApproval.count()).toBe(0);
      expect(await db.client.assignmentEvent.count()).toBe(0);
      expect(await db.client.expertReview.findUnique({ where: { id: seed.review.id } })).toMatchObject({ summary: "Synthetic preserved review" });
      expect(await db.client.user.findUnique({ where: { id: seed.expert.id } })).toMatchObject({ role: "EXPERT" });
      // A second deployment is a no-op, not a new initial migration.
      db.deploy();
      // Missing historic approval remains missing even after an explicit safe cancellation.
      await db.client.$transaction(async tx => {
        await tx.expertAssignment.update({ where: { id: seed.assignmentId }, data: { status: "CANCELLED", cancelledAt: new Date(), revision: 1n } });
        await assignmentEvent(tx, seed.assignmentId, "ASSIGNED");
      });
      expect(await db.client.assignmentEvent.findFirst({ where: { assignmentId: seed.assignmentId } })).toMatchObject({ revision: 1n, credentialApprovalId: null });
    } finally { await db.close(); }
  });

  it("retains only known opaque legacy actor evidence when the assigning account is deleted", async () => {
    const db = await createExpertUpgradeDatabase();
    try {
      const seed = await legacy(db), terminalId = randomUUID();
      await db.client.$executeRaw`INSERT INTO "ExpertAssignment" (id,"videoId","expertId","assignedById",status,"cancelledAt")
        VALUES (${terminalId},${seed.video.id},${seed.expert.id},${seed.moderator.id},'CANCELLED',CURRENT_TIMESTAMP)`;
      db.deploy();
      const mapping = await db.client.expertActorIdentity.findUniqueOrThrow({ where: { userId: seed.moderator.id } });
      expect(await db.client.expertActorIdentity.count()).toBe(1);
      await db.client.user.delete({ where: { id: seed.moderator.id } });
      expect(await db.client.expertActorIdentity.count()).toBe(0);
      for (const id of [seed.assignmentId, terminalId]) {
        const row = await db.client.expertAssignment.findUniqueOrThrow({ where: { id } });
        expect(row).toMatchObject({ assignedById: null, assignedByEvidence: {
          subject: mapping.subjectId, source: "LEGACY_ASSIGNED_BY_ID",
        }, revision: 0n, credentialApprovalId: null, eventTransactionId: null });
        expect(JSON.stringify(row.assignedByEvidence)).not.toContain(seed.moderator.id);
      }
      expect(await db.client.assignmentEvent.count()).toBe(0);
      expect(await db.client.expertCredentialApproval.count()).toBe(0);
      // FK identity cleanup is not a domain mutation and cannot authorize a revision-0 event.
      await expectDatabaseError(assignmentEvent(db.client, seed.assignmentId, null), "Assignment event requires the matching mutation in this transaction");
    } finally { await db.close(); }
  });

  it("rejects fabricated legacy events, incorrect fromStatus and contradictory transition history", async () => {
    const db = await createExpertUpgradeDatabase();
    try {
      const seed = await legacy(db);
      db.deploy();
      for (const previous of [null, "COMPLETED", "IN_PROGRESS"] as const)
        await expectDatabaseError(assignmentEvent(db.client, seed.assignmentId, previous), "Assignment event requires the matching mutation in this transaction");
      await expectDatabaseError(db.client.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "ExpertAssignment" SET status='IN_PROGRESS',revision=1 WHERE id=${seed.assignmentId}`;
        await assignmentEvent(tx, seed.assignmentId, "COMPLETED");
      }), "Assignment event requires the matching mutation in this transaction");
      await expectDatabaseError(db.client.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "ExpertAssignment" SET status='IN_PROGRESS',revision=1 WHERE id=${seed.assignmentId}`;
        await tx.$executeRaw`INSERT INTO "AssignmentEvent" ("assignmentId",revision,"fromStatus","toStatus","actorEvidence",snapshot)
          SELECT id,revision,'ASSIGNED','COMPLETED','{"subject":"synthetic-review-actor"}'::jsonb,
            to_jsonb(a)-ARRAY['assignedById','expertId','eventFromStatus','eventTransactionId']::text[]
          FROM "ExpertAssignment" a WHERE id=${seed.assignmentId}`;
      }), "Assignment event requires the matching mutation in this transaction");
      expect(await db.client.expertAssignment.findUnique({ where: { id: seed.assignmentId } })).toMatchObject({ status: "ASSIGNED", revision: 0n });
      expect(await db.client.assignmentEvent.count()).toBe(0);
      // Positive control: the exact same domain mutation with correct history succeeds.
      await db.client.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "ExpertAssignment" SET status='IN_PROGRESS',revision=1 WHERE id=${seed.assignmentId}`;
        await assignmentEvent(tx, seed.assignmentId, "ASSIGNED");
      });
      expect(await db.client.assignmentEvent.count()).toBe(1);
    } finally { await db.close(); }
  });

  it("rolls back executed DDL and legacy evidence backfill after a deliberately late failure", async () => {
    const db = await createExpertUpgradeDatabase();
    try {
      const seed = await legacy(db);
      const [before] = await db.client.$queryRaw<{ row: unknown }[]>`SELECT to_jsonb(a) AS row FROM "ExpertAssignment" a WHERE id=${seed.assignmentId}`;
      // This collision happens after ALTER TABLE, table/index/FK creation and actor backfill.
      await db.client.$executeRawUnsafe('CREATE FUNCTION c031_actor(jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$');
      let failure: { stderr?: Buffer; stdout?: Buffer } | undefined;
      // Execute the exact migration file directly: migrate deploy can mask the
      // original error while attempting bookkeeping inside an aborted transaction.
      try { db.executeMigrationSQL(); } catch (error) { failure = error as typeof failure; }
      expect(failure).toBeDefined();
      expect(`${failure?.stderr ?? ""}${failure?.stdout ?? ""}`).toContain('c031_actor');
      const [after] = await db.client.$queryRaw<{ row: unknown }[]>`SELECT to_jsonb(a) AS row FROM "ExpertAssignment" a WHERE id=${seed.assignmentId}`;
      expect(after.row).toEqual(before.row);
      const objects = await db.client.$queryRaw<{ credential: string | null; actor: string | null; status: string | null; activeIndex: string | null }[]>`
        SELECT to_regclass('"ExpertCredential"')::text AS credential,to_regclass('"ExpertActorIdentity"')::text AS actor,
          to_regtype('"ExpertCredentialStatus"')::text AS status,to_regclass('"ExpertAssignment_one_active_video"')::text AS "activeIndex"`;
      expect(objects).toEqual([{ credential: null, actor: null, status: null, activeIndex: null }]);
      expect(await db.client.expertReview.findUnique({ where: { id: seed.review.id } })).toMatchObject({ summary: "Synthetic preserved review" });
    } finally { await db.close(); }
  });

  it("fails atomically on duplicate active legacy assignments without choosing a winner", async () => {
    const db = await createExpertUpgradeDatabase();
    try {
      const seed = await legacy(db);
      await db.client.$executeRaw`INSERT INTO "ExpertAssignment" (id,"videoId","expertId","assignedById")
        VALUES (${randomUUID()},${seed.video.id},${seed.expert.id},${seed.moderator.id})`;
      expect(() => db.deploy()).toThrow();
      expect(await db.client.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE "videoId"=${seed.video.id}`).toHaveLength(2);
      const [table] = await db.client.$queryRaw<{ name: string | null }[]>`SELECT to_regclass('"ExpertCredential"')::text AS name`;
      expect(table.name).toBeNull();
    } finally { await db.close(); }
  });

  it("fails on orphan assignedById without dropping or rewriting legacy rows", async () => {
    const db = await createExpertUpgradeDatabase();
    try {
      const seed = await legacy(db, true);
      expect(() => db.deploy()).toThrow();
      const rows = await db.client.$queryRaw<{ assignedById: string }[]>`SELECT "assignedById" FROM "ExpertAssignment" WHERE id=${seed.assignmentId}`;
      expect(rows).toEqual([{ assignedById: "missing-actor" }]);
    } finally { await db.close(); }
  });
});
