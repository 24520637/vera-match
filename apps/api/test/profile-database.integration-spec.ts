import { MemberResource, Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAuthDatabase } from "./disposable-auth-database";

const prismaDirectory = resolve(__dirname, "../prisma");
const initialMigration = "20261111110738_init";
const revisionMigration = "20261115160000_add_member_resource_revisions";

describe("C019 additive profile persistence migration", () => {
  let admin: PrismaClient | undefined;
  let db: PrismaClient;
  let schema: string;
  let databaseUrl: string;
  let before: unknown;
  const legacyUserId = "c019-synthetic-legacy";

  function migrate(schemaPath: string) {
    execFileSync(process.execPath, [
      resolve(__dirname, "../../../node_modules/prisma/build/index.js"),
      "migrate", "deploy", "--schema", schemaPath,
    ], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe", windowsHide: true, timeout: 30000,
    });
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV !== "test" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.port !== "5433") {
      throw new Error("C019 requires test-only local PostgreSQL on port 5433");
    }
    schema = `vera_profile_test_${randomUUID().replaceAll("-", "")}`;
    url.searchParams.set("schema", schema);
    databaseUrl = url.toString();
    admin = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });

    // Upgrade from the exact historical migration, with deliberately malformed
    // synthetic legacy values. The configured public schema is never migrated.
    const baseline = mkdtempSync(join(tmpdir(), "vera-c019-"));
    try {
      cpSync(join(prismaDirectory, "schema.prisma"), join(baseline, "schema.prisma"));
      mkdirSync(join(baseline, "migrations"));
      cpSync(join(prismaDirectory, "migrations/migration_lock.toml"),
        join(baseline, "migrations/migration_lock.toml"));
      cpSync(join(prismaDirectory, "migrations", initialMigration),
        join(baseline, "migrations", initialMigration), { recursive: true });
      migrate(join(baseline, "schema.prisma"));
    } finally {
      if (resolve(baseline).startsWith(`${resolve(tmpdir())}\\vera-c019-`) === false &&
          resolve(baseline).startsWith(`${resolve(tmpdir())}/vera-c019-`) === false) {
        throw new Error("Unsafe temporary migration cleanup");
      }
      rmSync(baseline, { recursive: true, force: true });
    }
    await db.user.create({ data: {
      id: legacyUserId, email: "c019-legacy@example.invalid", passwordHash: "synthetic-not-a-password",
      profile: { create: { interests: { malformed: true }, values: Prisma.JsonNull } },
      preferences: { create: { minAge: 90, maxAge: 20, priorities: "legacy-invalid" } },
      questionnaireAnswers: { create: [
        { questionKey: "legacy-key", questionnaireVersion: 1, responseText: "Keep old meaning." },
        { questionKey: "legacy-key", questionnaireVersion: 2, responseText: "Keep new meaning." },
      ] },
      sessions: { create: { tokenHash: "c019-synthetic-token-hash", expiresAt: new Date("2099-01-01Z") } },
    } });
    before = await snapshot();
    migrate(join(prismaDirectory, "schema.prisma"));
  }, 90000);

  afterAll(async () => {
    await db?.$disconnect();
    try {
      if (admin && /^vera_profile_test_[a-f0-9]{32}$/.test(schema)) {
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      await admin?.$disconnect();
    }
  });

  async function snapshot() {
    const user = await db.user.findUnique({ where: { id: legacyUserId }, include: {
      profile: true, preferences: true, sessions: true,
      questionnaireAnswers: { orderBy: { questionnaireVersion: "asc" } },
    } });
    // Prisma projects SQL NULL and JSON null identically; check storage too.
    const nulls = await db.$queryRaw`
      SELECT "interests"::text AS interests, "values"::text AS values,
             "values" IS NULL AS sql_null, "birthDate"
      FROM "Profile" WHERE "userId" = ${legacyUserId}`;
    return { user, nulls };
  }

  async function member() {
    return db.user.create({ data: {
      email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-not-a-password",
    } });
  }

  it("preserves every legacy value, old catalog and authentication field on upgrade", async () => {
    expect(await snapshot()).toEqual(before);
    expect(await db.memberResourceRevision.count()).toBe(0);
    const history = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
    expect(history.map(row => row.migration_name)).toEqual([initialMigration, revisionMigration]);
  });

  it("deploys the complete migration history into a fresh isolated schema", async () => {
    const fresh = await createAuthDatabase();
    try {
      expect(await fresh.client.memberResourceRevision.count()).toBe(0);
      expect(await fresh.client.questionnaireAnswer.count()).toBe(0);
    } finally {
      await fresh.close();
    }
  });

  it("keeps catalog uniqueness, resource ownership and query indexes", async () => {
    await expect(db.questionnaireAnswer.create({ data: {
      userId: legacyUserId, questionKey: "legacy-key", questionnaireVersion: 1, responseText: "Duplicate",
    } })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.memberResourceRevision.create({ data: {
      userId: "missing-member", resource: MemberResource.PROFILE,
    } })).rejects.toMatchObject({ code: "P2003" });
    const indexes = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`;
    expect(indexes.map(row => row.indexname)).toContain("QuestionnaireAnswer_userId_questionnaireVersion_idx");
  });

  it("enforces independent counters, uniqueness and safe integer bounds", async () => {
    const user = await member();
    for (const resource of Object.values(MemberResource)) {
      await db.memberResourceRevision.create({ data: { userId: user.id, resource } });
    }
    await expect(db.memberResourceRevision.create({ data: {
      userId: user.id, resource: MemberResource.PROFILE,
    } })).rejects.toMatchObject({ code: "P2002" });
    for (const revision of [-1n, 9007199254740992n]) {
      await expect(db.memberResourceRevision.updateMany({
        where: { userId: user.id, resource: MemberResource.PROFILE }, data: { revision },
      })).rejects.toThrow();
    }
    await db.memberResourceRevision.updateMany({
      where: { userId: user.id, resource: MemberResource.PROFILE }, data: { revision: 9007199254740991n },
    });
    const rows = await db.memberResourceRevision.findMany({ where: { userId: user.id } });
    expect(rows.find(row => row.resource === MemberResource.PROFILE)?.revision).toBe(9007199254740991n);
    expect(rows.filter(row => row.resource !== MemberResource.PROFILE).every(row => row.revision === 0n)).toBe(true);
  });

  it("serializes first writes and stale CAS updates without losing the winner", async () => {
    const user = await member();
    const initialize = (city: string) => db.$transaction(async tx => {
      await tx.memberResourceRevision.create({ data: {
        userId: user.id, resource: MemberResource.PROFILE, revision: 1n,
      } });
      await tx.profile.create({ data: { userId: user.id, city } });
    });
    const first = await Promise.allSettled([initialize("First"), initialize("Second")]);
    expect(first.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const change = (city: string) => db.$transaction(async tx => {
      const result = await tx.memberResourceRevision.updateMany({
        where: { userId: user.id, resource: MemberResource.PROFILE, revision: 1n },
        data: { revision: { increment: 1n } },
      });
      if (!result.count) throw new Error("Stale resource revision");
      await tx.profile.update({ where: { userId: user.id }, data: { city } });
      return city;
    });
    const results = await Promise.allSettled([change("Winner A"), change("Winner B")]);
    const winner = results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<string>;
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await db.profile.findUniqueOrThrow({ where: { userId: user.id } })).city).toBe(winner.value);
    expect((await db.memberResourceRevision.findUniqueOrThrow({ where: {
      userId_resource: { userId: user.id, resource: MemberResource.PROFILE },
    } })).revision).toBe(2n);
  });

  it("rolls back revisions and all answers together; clearing data cannot reset metadata", async () => {
    const user = await member();
    await db.memberResourceRevision.create({ data: {
      userId: user.id, resource: MemberResource.QUESTIONNAIRE, revision: 1n,
    } });
    await expect(db.$transaction(async tx => {
      await tx.memberResourceRevision.updateMany({
        where: { userId: user.id, resource: MemberResource.QUESTIONNAIRE, revision: 1n },
        data: { revision: { increment: 1n } },
      });
      await tx.questionnaireAnswer.createMany({ data: [
        { userId: user.id, questionKey: "everyday-life", questionnaireVersion: 1, responseText: "Synthetic" },
        { userId: user.id, questionKey: "everyday-life", questionnaireVersion: 1, responseText: "Duplicate" },
      ] });
    })).rejects.toThrow();
    expect(await db.questionnaireAnswer.count({ where: { userId: user.id } })).toBe(0);
    await db.questionnaireAnswer.createMany({ data: [1, 2].map(questionnaireVersion => ({
      userId: user.id, questionKey: "everyday-life", questionnaireVersion, responseText: "Retained catalog",
    })) });
    await db.questionnaireAnswer.deleteMany({ where: { userId: user.id } });
    expect((await db.memberResourceRevision.findUniqueOrThrow({ where: {
      userId_resource: { userId: user.id, resource: MemberResource.QUESTIONNAIRE },
    } })).revision).toBe(1n);
  });

  it("retains profile/preferences revisions when optional data rows are removed", async () => {
    const user = await member();
    await db.profile.create({ data: { userId: user.id } });
    await db.matchPreference.create({ data: { userId: user.id } });
    await db.memberResourceRevision.createMany({ data: [MemberResource.PROFILE, MemberResource.PREFERENCES]
      .map(resource => ({ userId: user.id, resource, revision: 3n })) });
    await db.profile.delete({ where: { userId: user.id } });
    await db.matchPreference.delete({ where: { userId: user.id } });
    const rows = await db.memberResourceRevision.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.revision === 3n)).toBe(true);
  });

  it("preserves old catalogs while saving three answers with one editing revision", async () => {
    const user = await member();
    const keys = ["relationship-intention", "everyday-life", "values-and-boundaries"];
    for (const questionnaireVersion of [1, 2]) {
      await db.$transaction(async tx => {
        if (questionnaireVersion === 1) {
          await tx.memberResourceRevision.create({ data: {
            userId: user.id, resource: MemberResource.QUESTIONNAIRE, revision: 1n,
          } });
        } else {
          const result = await tx.memberResourceRevision.updateMany({
            where: { userId: user.id, resource: MemberResource.QUESTIONNAIRE, revision: 1n },
            data: { revision: { increment: 1n } },
          });
          expect(result.count).toBe(1);
        }
        // Version 2 is a synthetic storage fixture, not an approved new catalog.
        await tx.questionnaireAnswer.createMany({ data: keys.map(questionKey => ({
          userId: user.id, questionnaireVersion, questionKey,
          responseText: `Synthetic version ${questionnaireVersion}`,
        })) });
      });
    }
    const answers = await db.questionnaireAnswer.findMany({ where: { userId: user.id } });
    expect(answers.filter(row => row.questionnaireVersion === 1)).toHaveLength(3);
    expect(answers.filter(row => row.questionnaireVersion === 2)).toHaveLength(3);
    expect((await db.memberResourceRevision.findUniqueOrThrow({ where: {
      userId_resource: { userId: user.id, resource: MemberResource.QUESTIONNAIRE },
    } })).revision).toBe(2n);
    expect(await db.memberResourceRevision.count({ where: { userId: user.id } })).toBe(1);
  });
});
