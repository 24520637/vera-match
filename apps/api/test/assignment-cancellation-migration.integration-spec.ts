import { AssignmentCancellationService } from "../src/assignment-cancellation/assignment-cancellation.service";
import { PrismaService } from "../src/database/prisma.service";
import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createAuthDatabase } from "./disposable-auth-database";
import { assign, seedExpert } from "./expert-db-fixtures";
const migration = "20261118050000_assignment_cancellation_evidence";
it("C051 adds evidence without rewriting C031-C034 history and atomically rolls back failed DDL", async () => {
  const admin = await createAuthDatabase(),
    schema = "vera_c051_upgrade_" + randomUUID().replaceAll("-", "");
  const url = new URL(admin.url);
  url.searchParams.set("schema", schema);
  const client = new PrismaClient({
    datasources: { db: { url: url.toString() } },
    log: [],
  });
  const temp = mkdtempSync(join(tmpdir(), "vera-c051-upgrade-")),
    prisma = resolve(__dirname, "../prisma");
  const run = (args: string[]) =>
    execFileSync(
      process.execPath,
      [
        resolve(__dirname, "../../../node_modules/prisma/build/index.js"),
        ...args,
      ],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: "pipe",
        windowsHide: true,
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
      (n) => /^\d+_/.test(n) && n < migration,
    ))
      cpSync(join(prisma, "migrations", name), join(temp, "migrations", name), {
        recursive: true,
      });
    run(["migrate", "deploy", "--schema", join(temp, "schema.prisma")]);
    const seed = await seedExpert(client),
      assignment = await assign(client, seed);
    const before = await client.expertAssignment.findUnique({
        where: { id: assignment.id },
      }),
      events = await client.assignmentEvent.findMany({
        where: { assignmentId: assignment.id },
      });
    await client.$executeRawUnsafe(
      "CREATE FUNCTION c051_context_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
    );
    expect(() =>
      run([
        "db",
        "execute",
        "--file",
        join(prisma, "migrations", migration, "migration.sql"),
        "--schema",
        join(temp, "schema.prisma"),
      ]),
    ).toThrow();
    const [rolledBack] = await client.$queryRaw<
      { context: string | null; receipt: string | null }[]
    >`SELECT to_regclass('"AssignmentCancellationContext"')::text AS context,to_regclass('"AssignmentWithdrawalReceipt"')::text AS receipt`;
    expect(rolledBack).toEqual({ context: null, receipt: null });
    expect(
      await client.expertAssignment.findUnique({
        where: { id: assignment.id },
      }),
    ).toEqual(before);
    await client.$executeRawUnsafe("DROP FUNCTION c051_context_binding()");
    run(["migrate", "deploy", "--schema", join(prisma, "schema.prisma")]);
    expect(
      await client.expertAssignment.findUnique({
        where: { id: assignment.id },
      }),
    ).toEqual(before);
    expect(
      await client.assignmentEvent.findMany({
        where: { assignmentId: assignment.id },
      }),
    ).toEqual(events);
    expect(await client.assignmentCancellationContext.count()).toBe(0);
    expect(await client.assignmentWithdrawalReceipt.count()).toBe(0);
    run(["migrate", "deploy", "--schema", join(prisma, "schema.prisma")]);
  } finally {
    await client.$disconnect();
    try {
      if (!/^vera_c051_upgrade_[a-f0-9]{32}$/.test(schema))
        throw Error("Unsafe fixture cleanup");
      await admin.client.$executeRawUnsafe(
        'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE',
      );
    } finally {
      await admin.close();
      if (
        dirname(resolve(temp)) !== resolve(tmpdir()) ||
        !basename(temp).startsWith("vera-c051-upgrade-")
      )
        throw Error("Unsafe temporary fixture cleanup");
      rmSync(temp, { recursive: true, force: true });
    }
  }
}, 90000);

const scanMigration = "20261118120000_assignment_cancellation_scan";
it("durable scan migration preserves existing C051 cancellation and evidence, including failed and repeated deploy", async () => {
  const admin = await createAuthDatabase(),
    schema = "vera_c051_scan_" + randomUUID().replaceAll("-", "");
  const url = new URL(admin.url);
  url.searchParams.set("schema", schema);
  const client = new PrismaClient<Prisma.PrismaClientOptions>({
    datasources: { db: { url: url.toString() } },
    log: [],
    // Both the fixture update and cancellation reads use the pre-scan Video schema.
    omit: { video: { durationRetryEtag: true } },
  });
  const temp = mkdtempSync(join(tmpdir(), "vera-c051-scan-")),
    prisma = resolve(__dirname, "../prisma");
  const run = (args: string[]) =>
    execFileSync(
      process.execPath,
      [
        resolve(__dirname, "../../../node_modules/prisma/build/index.js"),
        ...args,
      ],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: "pipe",
        windowsHide: true,
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
      (n) => /^\d+_/.test(n) && n < scanMigration,
    ))
      cpSync(join(prisma, "migrations", name), join(temp, "migrations", name), {
        recursive: true,
      });
    run(["migrate", "deploy", "--schema", join(temp, "schema.prisma")]);
    const seed = await seedExpert(client),
      assignment = await assign(client, seed);
    await client.video.update({
      where: { id: seed.video.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    await new AssignmentCancellationService(
      client as unknown as PrismaService,
    ).processDeletedVideo(seed.video.id);
    const before = await client.expertAssignment.findUnique({
      where: { id: assignment.id },
    });
    const events = await client.assignmentEvent.findMany({
      where: { assignmentId: assignment.id },
      orderBy: { revision: "asc" },
    });
    const contexts = await client.assignmentCancellationContext.findMany();
    expect(contexts).toHaveLength(1);
    // Name collision must roll back without modifying the existing C051 evidence.
    await client.$executeRawUnsafe(
      'CREATE TABLE "AssignmentCancellationScan" (sentinel text)',
    );
    expect(() =>
      run([
        "db",
        "execute",
        "--file",
        join(prisma, "migrations", scanMigration, "migration.sql"),
        "--schema",
        join(temp, "schema.prisma"),
      ]),
    ).toThrow();
    await client.$executeRawUnsafe('DROP TABLE "AssignmentCancellationScan"');
    run(["migrate", "deploy", "--schema", join(prisma, "schema.prisma")]);
    expect(await client.assignmentCancellationScan.count()).toBe(0);
    await client.assignmentCancellationScan.create({
      data: { lane: "withdrawal", afterId: "a", throughId: "z" },
    });
    run(["migrate", "deploy", "--schema", join(prisma, "schema.prisma")]);
    expect(
      await client.assignmentCancellationScan.findUnique({
        where: { lane: "withdrawal" },
      }),
    ).toEqual({ lane: "withdrawal", afterId: "a", throughId: "z" });
    await expect(
      client.assignmentCancellationScan.create({
        data: { lane: "unapproved" },
      }),
    ).rejects.toThrow();
    await expect(
      client.assignmentCancellationScan.update({
        where: { lane: "withdrawal" },
        data: { throughId: null },
      }),
    ).rejects.toThrow();
    expect(
      await client.expertAssignment.findUnique({
        where: { id: assignment.id },
      }),
    ).toEqual(before);
    expect(
      await client.assignmentEvent.findMany({
        where: { assignmentId: assignment.id },
        orderBy: { revision: "asc" },
      }),
    ).toEqual(events);
    expect(await client.assignmentCancellationContext.findMany()).toEqual(
      contexts,
    );
  } finally {
    await client.$disconnect();
    try {
      if (!/^vera_c051_scan_[a-f0-9]{32}$/.test(schema))
        throw Error("Unsafe fixture cleanup");
      await admin.client.$executeRawUnsafe(
        'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE',
      );
    } finally {
      await admin.close();
      if (
        dirname(resolve(temp)) !== resolve(tmpdir()) ||
        !basename(temp).startsWith("vera-c051-scan-")
      )
        throw Error("Unsafe temporary fixture cleanup");
      rmSync(temp, { recursive: true, force: true });
    }
  }
}, 90000);
