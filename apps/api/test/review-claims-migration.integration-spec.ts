import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createAuthDatabase } from "./disposable-auth-database";
import { assign, seedExpert, transition } from "./expert-db-fixtures";

it("upgrades populated T10 and T12 schemas and masks historical T12 audit actors", async () => {
  const prisma = resolve(__dirname, "../prisma");
  const migrations = join(prisma, "migrations");
  const stage = mkdtempSync(join(tmpdir(), "vera-t12-upgrade-"));
  const schemaPath = join(stage, "schema.prisma");
  const t12 = readdirSync(migrations).filter(name => /^2026112011[1-4]000_/.test(name)).sort();
  const t10 = "20261121100000_durable_review_decision_evidence";
  let db: Awaited<ReturnType<typeof createAuthDatabase>> | undefined;
  try {
    expect(t12).toHaveLength(4);
    cpSync(join(prisma, "schema.prisma"), schemaPath);
    mkdirSync(join(stage, "migrations"));
    cpSync(join(migrations, "migration_lock.toml"), join(stage, "migrations/migration_lock.toml"));
    const copy = (name: string) => cpSync(join(migrations, name), join(stage, "migrations", name), { recursive: true });
    readdirSync(migrations).filter(name => /^\d+_/.test(name) && name <= t10 && !t12.includes(name)).forEach(copy);
    db = await createAuthDatabase(schemaPath);
    const { client, url } = db;
    const deploy = (path: string) => execFileSync(process.execPath, [
      resolve(__dirname, "../../../node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", path,
    ], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", windowsHide: true, timeout: 30000 });

    const seed = await seedExpert(client);
    const assignment = await assign(client, seed);
    for (const [revision, status] of (["IN_PROGRESS", "SUBMITTED", "COMPLETED"] as const).entries())
      await transition(client, assignment.id, BigInt(revision), status);
    const decidedAt = new Date();
    const review = await client.expertReview.create({ data: { assignmentId: assignment.id, status: "APPROVED", version: 3,
      summary: "Synthetic approved report.", limitations: "One recording.", qaById: seed.moderator.id, qaAt: decidedAt, submittedAt: decidedAt } });
    await client.expertActorIdentity.upsert({ where: { userId: seed.moderator.id }, create: { userId: seed.moderator.id }, update: {} });
    await client.reviewDecision.create({ data: { reviewId: review.id, version: 3, status: "APPROVED", moderatorId: seed.moderator.id, decidedAt } });
    const evidence = await client.reviewDecisionEvidence.findMany({ where: { reviewId: review.id } });
    expect(evidence).toHaveLength(1);
    const claimId = randomUUID();
    const disputeId = randomUUID();
    await client.$executeRaw`INSERT INTO "ReviewClaim" (id, "reviewId", "claimType", "claimText", "qaApproved", "ownerConfirmed", "shareApproved")
      VALUES (${claimId}, ${review.id}, 'INTEREST_READING', 'Synthetic legacy claim.', true, true, true)`;
    await client.$executeRaw`INSERT INTO "ReviewDispute" (id, "reviewId", "ownerId", reason)
      VALUES (${disputeId}, ${review.id}, ${seed.expert.id}, 'Synthetic legacy dispute.')`;

    t12.forEach(copy);
    deploy(schemaPath);
    await expect(client.reviewClaim.findUnique({ where: { id: claimId } })).resolves.toMatchObject({
      reviewVersion: null, ownerId: null, claimText: "Synthetic legacy claim.", shareApproved: true,
    });
    await expect(client.reviewDispute.findUnique({ where: { id: disputeId } })).resolves.toMatchObject({
      reviewVersion: null, status: "OPEN", reason: "Synthetic legacy dispute.",
    });

    const audit = (action: string, actorId: string | null) =>
      client.auditLog.create({ data: { action, actorId, subjectType: "ReviewDispute", subjectId: disputeId } });
    const t10Audit = await audit("EXPERT_REVIEW_OWNER_REPORTS_READ", seed.expert.id);
    const unrelated = await audit("UNRELATED", seed.expert.id);
    const feedback = await audit("REVIEW_CLAIM_FEEDBACK_SAVED", seed.expert.id);
    const approval = await audit("REVIEW_CLAIMS_APPROVED", seed.moderator.id);
    const missing = await audit("REVIEW_DISPUTE_RESOLVED", randomUUID());
    const system = await audit("REVIEW_DISPUTE_CLOSED_VIDEO_DELETED", null);

    const fullSchema = join(prisma, "schema.prisma");
    deploy(fullSchema);
    deploy(fullSchema);
    const readAudit = (id: string) => client.auditLog.findUnique({ where: { id } });
    await expect(readAudit(t10Audit.id)).resolves.toEqual(t10Audit);
    await expect(readAudit(unrelated.id)).resolves.toEqual(unrelated);
    await expect(readAudit(feedback.id)).resolves.toEqual({ ...feedback, actorId: t10Audit.actorId });
    await expect(readAudit(approval.id)).resolves.toEqual({
      ...approval, actorId: (await client.expertActorIdentity.findUniqueOrThrow({ where: { userId: seed.moderator.id } })).subjectId,
    });
    await expect(readAudit(missing.id)).resolves.toEqual({ ...missing, actorId: null });
    await expect(readAudit(system.id)).resolves.toEqual(system);
    await expect(client.reviewDecisionEvidence.findMany({ where: { reviewId: review.id } })).resolves.toEqual(evidence);
    await expect(client.$executeRaw`UPDATE "AuditLog" SET action = 'REVIEW_DISPUTE_OPENED' WHERE id = ${unrelated.id}`)
      .rejects.toMatchObject({ meta: { code: "23514" } });
  } finally {
    try {
      await db?.close();
    } finally {
      if (dirname(resolve(stage)) !== resolve(tmpdir()) || !basename(stage).startsWith("vera-t12-upgrade-"))
        throw new Error("Unsafe upgrade fixture cleanup");
      rmSync(stage, { recursive: true, force: true });
    }
  }
}, 90000);
