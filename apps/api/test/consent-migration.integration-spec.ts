import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { createAuthDatabase } from "./disposable-auth-database";

const migration = "20261116020000_add_consent_evidence_and_handoff";
describe("C023 additive migration upgrade", () => {
  it("upgrades prior migrations without changing legacy consent, Auth or AuditLog", async () => {
    const database = await createAuthDatabase(); // Validates NODE_ENV/loopback/test port first.
    const schema = `vera_consent_upgrade_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(database.url); url.searchParams.set("schema", schema);
    const client = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
    const temp = mkdtempSync(join(tmpdir(), "vera-c023-upgrade-"));
    const prisma = resolve(__dirname, "../prisma");
    const deploy = (file: string) => execFileSync(process.execPath, [resolve(__dirname, "../../../node_modules/prisma/build/index.js"),
      "migrate", "deploy", "--schema", file], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe", windowsHide: true, timeout: 30000 });
    try {
      await database.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      cpSync(join(prisma, "schema.prisma"), join(temp, "schema.prisma"));
      mkdirSync(join(temp, "migrations"));
      cpSync(join(prisma, "migrations/migration_lock.toml"), join(temp, "migrations/migration_lock.toml"));
      for (const name of readdirSync(join(prisma, "migrations")).filter(name => /^\d+_/.test(name) && name !== migration)) {
        cpSync(join(prisma, "migrations", name), join(temp, "migrations", name), { recursive: true });
      }
      deploy(join(temp, "schema.prisma"));
      const user = await client.user.create({ data: { email: "synthetic-upgrade@example.invalid", passwordHash: "synthetic-password-hash" } });
      await client.$executeRaw`INSERT INTO "Consent" (id, "userId", purpose, granted, "grantedAt", "updatedAt")
        VALUES ('synthetic-legacy', ${user.id}, 'VIDEO_STORAGE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
      await client.auditLog.create({ data: { actorId: user.id, action: "SYNTHETIC_AUTH_AUDIT", subjectType: "User", subjectId: user.id } });
      const before = await client.$queryRaw`SELECT id, "userId", purpose, granted, "grantedAt", "revokedAt", "updatedAt" FROM "Consent"`;
      const authBefore = await client.user.findUnique({ where: { id: user.id } });
      const auditBefore = await client.auditLog.findMany();
      deploy(join(prisma, "schema.prisma"));
      expect(await client.$queryRaw`SELECT id, "userId", purpose, granted, "grantedAt", "revokedAt", "updatedAt" FROM "Consent"`).toEqual(before);
      expect(await client.consent.findFirst()).toMatchObject({ granted: true, policyVersion: null, policyEvidenceId: null });
      expect(await client.user.findUnique({ where: { id: user.id } })).toEqual(authBefore);
      expect(await client.auditLog.findMany()).toEqual(auditBefore);
      expect(await client.consentLedger.count()).toBe(0);
      expect(await client.consentEvent.count()).toBe(0);
      expect(await client.consentPolicyEvidence.count()).toBe(0);
    } finally {
      await client.$disconnect();
      try {
        if (!/^vera_consent_upgrade_[a-f0-9]{32}$/.test(schema)) throw new Error("Unsafe schema cleanup");
        await database.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await database.close();
        if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith("vera-c023-upgrade-")) throw new Error("Unsafe temp cleanup");
        rmSync(temp, { recursive: true, force: true });
      }
    }
  }, 90000);
});
