import { AssignmentStatus, ExpertCredentialEventKind, Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export const actor = { subject: "synthetic-moderator-subject" };
export function evidence(content = "SYNTHETIC TEST EVIDENCE ONLY") {
  return { kind: "SNAPSHOT", content, sha256: createHash("sha256").update(content).digest("hex") };
}
export async function seedExpert(p: PrismaClient) {
  const expert = await p.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-only", role: "EXPERT" } });
  const moderator = await p.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-only", role: "MODERATOR" } });
  // Legacy upgrade schemas intentionally lack later Video columns.
  const video = await p.video.create({ data: { ownerId: expert.id, bucket: "synthetic-private", objectKey: randomUUID(), mimeType: "video/mp4" }, select: { id: true } });
  await p.$transaction(async tx => {
    const row = await tx.expertCredential.create({ data: { userId: expert.id } });
    await credentialEvent(tx, row, "CREATED");
  });
  const approval = await approve(p, expert.id);
  return { expert, moderator, video, approval };
}
export async function credentialEvent(tx: Prisma.TransactionClient, row: {
  subjectId: string; revision: bigint; status: "PENDING" | "APPROVED" | "REVOKED"; approvalId: string | null; revokedAt: Date | null;
}, kind: ExpertCredentialEventKind, reason?: string, createdAt?: Date) {
  return tx.expertCredentialEvent.create({ data: { subjectId: row.subjectId, revision: row.revision, status: row.status,
    approvalId: row.approvalId, revokedAt: row.revokedAt, kind, actorEvidence: actor, evidence: evidence(), reason, createdAt } });
}
export async function approve(p: PrismaClient, userId: string) {
  return p.$transaction(async tx => {
    const row = await tx.expertCredential.findUniqueOrThrow({ where: { userId } });
    const approval = await tx.expertCredentialApproval.create({ data: { subjectId: row.subjectId,
      trainingVersion: "synthetic-training-v1", policyVersion: "synthetic-confidentiality-v1",
      trainingEvidence: evidence(), confidentialityEvidence: { kind: "PRIVATE_REFERENCE", bucket: "synthetic-private", objectKey: "opaque-evidence" },
      verifiedByEvidence: actor, approvedByEvidence: actor, verifiedAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: new Date("2099-01-01T00:00:00Z") } });
    const next = await tx.expertCredential.update({ where: { userId }, data: { status: "APPROVED", approvalId: approval.id,
      revokedAt: null, revision: { increment: 1 } } });
    await credentialEvent(tx, next, "APPROVED");
    return approval;
  });
}
export async function assignmentEvent(tx: Prisma.TransactionClient, id: string, previous: AssignmentStatus | null, createdAt?: Date) {
  await tx.$executeRaw`INSERT INTO "AssignmentEvent" ("assignmentId",revision,"fromStatus","toStatus","credentialApprovalId","actorEvidence",snapshot,"createdAt")
    SELECT id,revision,${previous}::"AssignmentStatus",status,"credentialApprovalId",${JSON.stringify(actor)}::jsonb,to_jsonb(a)-ARRAY['assignedById','expertId','eventFromStatus','eventTransactionId']::text[],
      COALESCE(${createdAt ?? null}::timestamp, CURRENT_TIMESTAMP)
    FROM "ExpertAssignment" a WHERE id=${id}`;
}

export async function expectDatabaseError(operation: Promise<unknown>, message: string, code = "23514") {
  await expect(operation).rejects.toMatchObject({ code: "P2010", meta: { code, message: expect.stringContaining(message) } });
}
export async function assign(p: PrismaClient, seed: Awaited<ReturnType<typeof seedExpert>>) {
  return p.$transaction(async tx => {
    const row = await tx.expertAssignment.create({ data: { videoId: seed.video.id, expertId: seed.expert.id,
      assignedById: seed.moderator.id, assignedByEvidence: actor, credentialApprovalId: seed.approval.id } });
    await assignmentEvent(tx, row.id, null);
    return row;
  });
}
export async function transition(p: PrismaClient, id: string, revision: bigint, status: AssignmentStatus) {
  return p.$transaction(async tx => {
    const before = await tx.expertAssignment.findUniqueOrThrow({ where: { id } });
    const changed = await tx.expertAssignment.updateMany({ where: { id, revision }, data: {
      status, revision: { increment: 1 }, cancelledAt: status === "CANCELLED" ? new Date() : null } });
    if (changed.count !== 1) throw new Error("RESOURCE_REVISION_CONFLICT");
    await assignmentEvent(tx, id, before.status);
    return tx.expertAssignment.findUniqueOrThrow({ where: { id } });
  });
}

/** Legacy upgrade fixture: only a freshly created, UUID-named test schema is mutated. */
export async function createExpertUpgradeDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.NODE_ENV !== "test" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.port !== "5433")
    throw new Error("Disposable loopback test database required");
  const schema = `vera_expert_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new PrismaClient();
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set("schema", schema);
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const cli = resolve(__dirname, "../../../node_modules/prisma/build/index.js");
  function run(args: string[]) {
    return execFileSync(process.execPath, [cli, ...args], { env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: "pipe", windowsHide: true, timeout: 30000 });
  }
  async function close() {
    await client.$disconnect();
    if (!/^vera_expert_test_[a-f0-9]{32}$/.test(schema)) throw new Error("Unsafe test schema");
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
  try {
    run(["db", "execute", "--file", resolve(__dirname, "../prisma/migrations/20261111110738_init/migration.sql"), "--url", url.toString()]);
    run(["migrate", "resolve", "--applied", "20261111110738_init", "--schema", resolve(__dirname, "../prisma/schema.prisma")]);
  } catch (error) { await close(); throw error; }
  return { client, close,
    deployReviewedBaseline: () => {
      for (const name of ["20261115160000_add_member_resource_revisions",
        "20261116020000_add_consent_evidence_and_handoff",
        "20261116120000_add_expert_credentials_and_assignment_revision"]) {
        run(["db", "execute", "--file", resolve(__dirname, "../prisma/migrations", name, "migration.sql"), "--url", url.toString()]);
        run(["migrate", "resolve", "--applied", name, "--schema", resolve(__dirname, "../prisma/schema.prisma")]);
      }
    },
    deploy: () => run(["migrate", "deploy", "--schema", resolve(__dirname, "../prisma/schema.prisma")]),
    executeMigrationSQL: () => run(["db", "execute", "--file", resolve(__dirname,
      "../prisma/migrations/20261116120000_add_expert_credentials_and_assignment_revision/migration.sql"), "--url", url.toString()]),
  };
}
