import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createAuthDatabase } from "./disposable-auth-database";
import { actor, assignmentEvent, seedExpert } from "./expert-db-fixtures";

it("adds closure to the merged schema without changing legacy users, assignment bindings, receipts or history", async () => {
  const admin = await createAuthDatabase();
  const schema = "vera_closure_upgrade_" + randomUUID().replaceAll("-", "");
  const url = new URL(admin.url);
  url.searchParams.set("schema", schema);
  const client = new PrismaClient({
    datasources: { db: { url: url.toString() } },
    log: [],
  });
  const temp = mkdtempSync(join(tmpdir(), "vera-closure-upgrade-"));
  const prisma = resolve(__dirname, "../prisma");
  const run = (path: string) =>
    execFileSync(
      process.execPath,
      [
        resolve(__dirname, "../../../node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--schema",
        path,
      ],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        windowsHide: true,
        stdio: "pipe",
        timeout: 30000,
      },
    );
  try {
    await admin.client.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
    cpSync(join(prisma, "schema.prisma"), join(temp, "schema.prisma"));
    mkdirSync(join(temp, "migrations"));
    cpSync(
      join(prisma, "migrations/migration_lock.toml"),
      join(temp, "migrations/migration_lock.toml"),
    );
    for (const name of readdirSync(join(prisma, "migrations")).filter(
      (name) =>
        /^\d+_/.test(name) && name !== "20261122133000_account_closure",
    ))
      cpSync(join(prisma, "migrations", name), join(temp, "migrations", name), {
        recursive: true,
      });
    run(join(temp, "schema.prisma"));
    const seed = await seedExpert(client);
    const subject = await client.consentSubject.create({ data: {} });
    const assignment = await client.$transaction(async (tx) => {
      const row = await tx.expertAssignment.create({
        data: {
          videoId: seed.video.id,
          expertId: seed.expert.id,
          assignedById: seed.moderator.id,
          assignedByEvidence: actor,
          credentialApprovalId: seed.approval.id,
          reviewConsentSubjectId: subject.id,
          reviewConsentVersion: 0n,
        },
      });
      await assignmentEvent(tx, row.id, null);
      return row;
    });
    const receipt = await client.assignmentIdempotency.create({
      data: {
        actorSubjectId: randomUUID(),
        operation: "CREATE_ASSIGNMENT",
        keyHash: "a".repeat(64),
        fingerprint: "b".repeat(64),
        assignmentId: assignment.id,
        response: { assignmentId: assignment.id },
      },
    });
    const events = await client.assignmentEvent.findMany({
      where: { assignmentId: assignment.id },
    });
    await client.$executeRawUnsafe(
      'INSERT INTO "Report" (id,"reporterId","targetUserId",reason,"updatedAt") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)',
      "legacy-c033-report",
      seed.expert.id,
      seed.moderator.id,
      "SYNTHETIC legacy report",
    );
    run(join(prisma, "schema.prisma"));
    expect(await client.accountClosure.count()).toBe(0);
    expect((await client.user.findUniqueOrThrow({where:{id:seed.expert.id}})).role).toBe("EXPERT");
    expect(
      await client.expertAssignment.findUnique({
        where: { id: assignment.id },
      }),
    ).toEqual(assignment);
    expect(
      await client.assignmentEvent.findMany({
        where: { assignmentId: assignment.id },
      }),
    ).toEqual(events);
    expect(
      await client.assignmentIdempotency.findMany({
        where: { assignmentId: assignment.id },
      }),
    ).toEqual([receipt]);
    expect(
      await client.report.findUnique({ where: { id: "legacy-c033-report" } }),
    ).toMatchObject({
      reason: "SYNTHETIC legacy report",
      reasonCode: null,
      revision: 0n,
    });
    run(join(prisma, "schema.prisma"));
  } finally {
    await client.$disconnect();
    try {
      if (!/^vera_closure_upgrade_[a-f0-9]{32}$/.test(schema))
        throw new Error("Unsafe test cleanup");
      await admin.client.$executeRawUnsafe(
        'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE',
      );
    } finally {
      await admin.close();
      if (
        dirname(resolve(temp)) !== resolve(tmpdir()) ||
        !basename(temp).startsWith("vera-closure-upgrade-")
      )
        throw new Error("Unsafe temporary fixture cleanup");
      rmSync(temp, { recursive: true, force: true });
    }
  }
}, 90000);
