import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createAuthDatabase } from "./disposable-auth-database";
import { assign, seedExpert } from "./expert-db-fixtures";

const migration = "20261118120000_assignment_moderator_grants";
describe("C035 PA2 additive migration", () => {
  it("preserves legacy assignments, identities and events; rolls DDL back before a clean upgrade", async () => {
    const admin = await createAuthDatabase(), schema = `vera_c035_upgrade_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(admin.url); url.searchParams.set("schema", schema);
    const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const temp = mkdtempSync(join(tmpdir(), "vera-c035-upgrade-")), prisma = resolve(__dirname, "../prisma");
    const run = (args: string[]) => execFileSync(process.execPath,
      [resolve(__dirname, "../../../node_modules/prisma/build/index.js"), ...args],
      { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe", windowsHide: true, timeout: 30000 });
    try {
      await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      cpSync(join(prisma, "schema.prisma"), join(temp, "schema.prisma"));
      mkdirSync(join(temp, "migrations"));
      cpSync(join(prisma, "migrations/migration_lock.toml"), join(temp, "migrations/migration_lock.toml"));
      for (const name of readdirSync(join(prisma, "migrations")).filter(name => /^\d+_/.test(name) && name < migration))
        cpSync(join(prisma, "migrations", name), join(temp, "migrations", name), { recursive: true });
      run(["migrate", "deploy", "--schema", join(temp, "schema.prisma")]);
      const seed = await seedExpert(client); await assign(client, seed);
      const rows = await client.expertAssignment.findMany(), events = await client.assignmentEvent.findMany();
      const identities = await client.expertAssignmentIdentity.findMany(), users = await client.user.findMany();
      // Collision occurs after tables, indexes, FK and the first function exist.
      await client.$executeRawUnsafe('CREATE FUNCTION c035_grant_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
      let failure = "";
      try { run(["db", "execute", "--file", join(prisma, "migrations", migration, "migration.sql"), "--url", url.toString()]); }
      catch (error) { const result = error as { stdout?: Buffer; stderr?: Buffer };
        failure = `${result.stdout?.toString() ?? ""}\n${result.stderr?.toString() ?? ""}`; }
      expect(failure).toMatch(/function "c035_grant_event" already exists/);
      const [objects] = await client.$queryRaw<{ scope: string | null; event: string | null; mutation: string | null; kind: string | null }[]>`
        SELECT to_regclass('"AssignmentModeratorScope"')::text AS scope,
          to_regclass('"AssignmentModeratorGrantEvent"')::text AS event,
          to_regprocedure('c035_scope_mutation()')::text AS mutation,
          to_regtype('"AssignmentModeratorGrantKind"')::text AS kind`;
      expect(objects).toEqual({ scope: null, event: null, mutation: null, kind: null });
      expect(await client.expertAssignment.findMany()).toEqual(rows);
      expect(await client.assignmentEvent.findMany()).toEqual(events);
      await client.$executeRawUnsafe('DROP FUNCTION c035_grant_event()');
      run(["migrate", "deploy", "--schema", join(prisma, "schema.prisma")]);
      expect(await client.expertAssignment.findMany()).toEqual(rows);
      expect(await client.assignmentEvent.findMany()).toEqual(events);
      expect(await client.expertAssignmentIdentity.findMany()).toEqual(identities);
      expect(await client.user.findMany()).toEqual(users);
      expect(await client.assignmentModeratorScope.count()).toBe(0);
      expect(await client.assignmentModeratorGrantEvent.count()).toBe(0);
      const [column] = await client.$queryRaw<{ is_nullable: string; data_type: string }[]>`
        SELECT is_nullable,data_type FROM information_schema.columns
        WHERE table_schema=${schema} AND table_name='AssignmentModeratorGrantEvent' AND column_name='expiresAt'`;
      expect(column).toEqual({ is_nullable: "NO", data_type: "timestamp with time zone" });
      run(["migrate", "deploy", "--schema", join(prisma, "schema.prisma")]);
    } finally {
      await client.$disconnect();
      try {
        if (!/^vera_c035_upgrade_[a-f0-9]{32}$/.test(schema)) throw new Error("Unsafe schema cleanup");
        await admin.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.close();
        if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith("vera-c035-upgrade-")) throw new Error("Unsafe temp cleanup");
        rmSync(temp, { recursive: true, force: true });
      }
    }
  }, 90000);
});
