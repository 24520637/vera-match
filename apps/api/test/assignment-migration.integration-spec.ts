import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createAuthDatabase } from "./disposable-auth-database";
import { actor, assignmentEvent, seedExpert } from "./expert-db-fixtures";

const migration = "20261118010000_assignment_consent_and_idempotency";
describe("C033 additive migration", () => {
  it("preserves existing assignments/history and rolls back after DDL on a deliberate failure", async () => {
    const admin = await createAuthDatabase();
    const schema = `vera_c033_upgrade_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(admin.url); url.searchParams.set("schema", schema);
    const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const temp = mkdtempSync(join(tmpdir(), "vera-c033-upgrade-")), prisma = resolve(__dirname, "../prisma");
    const run = (args: string[]) => execFileSync(process.execPath, [resolve(__dirname, "../../../node_modules/prisma/build/index.js"), ...args],
      { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe", windowsHide: true, timeout: 30000 });
    try {
      await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      cpSync(join(prisma, "schema.prisma"), join(temp, "schema.prisma"));
      mkdirSync(join(temp, "migrations"));
      cpSync(join(prisma, "migrations/migration_lock.toml"), join(temp, "migrations/migration_lock.toml"));
      for (const name of readdirSync(join(prisma, "migrations")).filter(name => /^\d+_/.test(name) && name < migration))
        cpSync(join(prisma, "migrations", name), join(temp, "migrations", name), { recursive: true });
      run(["migrate", "deploy", "--schema", join(temp, "schema.prisma")]);
      const seed = await seedExpert(client), id = randomUUID();
      await client.$transaction(async tx => {
        await tx.$executeRaw`INSERT INTO "ExpertAssignment" (id,"videoId","expertId","assignedById","assignedByEvidence","credentialApprovalId")
          VALUES (${id},${seed.video.id},${seed.expert.id},${seed.moderator.id},${JSON.stringify(actor)}::jsonb,${seed.approval.id}::uuid)`;
        await assignmentEvent(tx, id, null);
      });
      const [before] = await client.$queryRaw<{ row: object }[]>`SELECT to_jsonb(a) AS row FROM "ExpertAssignment" a WHERE id=${id}`;
      const events = await client.assignmentEvent.findMany(), users = await client.user.findMany();
      await client.$executeRawUnsafe('CREATE FUNCTION c033_immutable_review_generation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
      // Collision happens after ALTER TABLE columns/constraints, not in preflight.
      expect(() => run(["db", "execute", "--file", join(prisma, "migrations", migration, "migration.sql"), "--url", url.toString()])).toThrow();
      const [rolledBack] = await client.$queryRaw<{ row: object }[]>`SELECT to_jsonb(a) AS row FROM "ExpertAssignment" a WHERE id=${id}`;
      expect(rolledBack.row).toEqual(before.row);
      const [missing] = await client.$queryRaw<{ name: string | null }[]>`SELECT to_regclass('"AssignmentIdempotency"')::text AS name`;
      expect(missing.name).toBeNull();
      await client.$executeRawUnsafe('DROP FUNCTION c033_immutable_review_generation()');
      run(["migrate", "deploy", "--schema", join(prisma, "schema.prisma")]);
      const [after] = await client.$queryRaw<{ row: object }[]>`SELECT to_jsonb(a) AS row FROM "ExpertAssignment" a WHERE id=${id}`;
      expect(after.row).toEqual({ ...before.row, reviewConsentSubjectId: null, reviewConsentVersion: null });
      expect(await client.assignmentEvent.findMany()).toEqual(events);
      expect(await client.user.findMany()).toEqual(users);
      expect(await client.assignmentIdempotency.count()).toBe(0);
      run(["migrate", "deploy", "--schema", join(prisma, "schema.prisma")]);
    } finally {
      await client.$disconnect();
      try {
        if (!/^vera_c033_upgrade_[a-f0-9]{32}$/.test(schema)) throw new Error("Unsafe cleanup schema");
        await admin.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.close();
        if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith("vera-c033-upgrade-")) throw new Error("Unsafe temp cleanup");
        rmSync(temp, { recursive: true, force: true });
      }
    }
  }, 90000);
});
