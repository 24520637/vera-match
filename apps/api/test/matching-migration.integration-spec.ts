import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createAuthDatabase } from "./disposable-auth-database";

const migration = "20261121110000_match_decision_invariants";

it("upgrades populated T12 pair data without activating or rewriting historical decisions", async () => {
  const source = resolve(__dirname, "../prisma");
  const temp = mkdtempSync(join(tmpdir(), "vera-t14-upgrade-"));
  const oldSchema = join(temp, "schema.prisma");
  let database: Awaited<ReturnType<typeof createAuthDatabase>> | undefined;
  try {
    cpSync(join(source, "schema.prisma"), oldSchema);
    mkdirSync(join(temp, "migrations"));
    cpSync(join(source, "migrations/migration_lock.toml"), join(temp, "migrations/migration_lock.toml"));
    for (const name of readdirSync(join(source, "migrations")).filter(name => /^\d+_/.test(name) && name < migration))
      cpSync(join(source, "migrations", name), join(temp, "migrations", name), { recursive: true });

    database = await createAuthDatabase(oldSchema);
    const { client, url } = database;
    await client.$executeRaw`INSERT INTO "MatchPair" (id, "userLowId", "userHighId", score, reasons)
      VALUES ('old-forward', 'a', 'b', 8, '{"legacy":"preserved"}'::jsonb), ('old-reverse', 'b', 'a', NULL, NULL)`;
    await client.$executeRaw`INSERT INTO "MatchDecision" (id, "pairId", "actorUserId", choice)
      VALUES ('valid-history', 'old-forward', 'a', 'ACCEPT'), ('foreign-history', 'old-reverse', 'foreign', 'DECLINE')`;
    const snapshot = await client.$queryRaw`SELECT id, "userLowId", "userHighId", score, reasons FROM "MatchPair" ORDER BY id`;
    const decisions = await client.matchDecision.findMany({ orderBy: { id: "asc" } });

    execFileSync(process.execPath, [
      resolve(__dirname, "../../../node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", join(source, "schema.prisma"),
    ], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", windowsHide: true, timeout: 30_000 });

    expect(await client.$queryRaw`SELECT id, "userLowId", "userHighId", score, reasons FROM "MatchPair" ORDER BY id`).toEqual(snapshot);
    expect(await client.matchDecision.findMany({ orderBy: { id: "asc" } })).toEqual(decisions);
    expect(await client.matchPair.count({ where: { lowConsentSubjectId: null, highConsentSubjectId: null } })).toBe(2);
    const stamps = { lowConsentSubjectId: randomUUID(), lowConsentVersion: 1n,
      highConsentSubjectId: randomUUID(), highConsentVersion: 1n };
    await expect(client.matchPair.create({ data: { userLowId: "y", userHighId: "x", ...stamps } })).rejects.toThrow();
    await expect(client.matchPair.create({ data: { userLowId: "x", userHighId: "x", ...stamps } })).rejects.toThrow();
    const pair = await client.matchPair.create({ data: { userLowId: "x", userHighId: "y", ...stamps } });
    await expect(client.matchDecision.create({ data: { pairId: pair.id, actorUserId: "foreign", choice: "ACCEPT" } })).rejects.toThrow();
    await expect(client.matchDecision.create({ data: { pairId: "old-forward", actorUserId: "b", choice: "ACCEPT" } })).rejects.toThrow();
    await expect(client.matchDecision.create({ data: { pairId: pair.id, actorUserId: "x", choice: "DECLINE" } })).resolves.toMatchObject({ choice: "DECLINE" });
    await expect(client.matchPair.update({ where: { id: pair.id }, data: { userHighId: "z" } })).rejects.toThrow();
  } finally {
    try { await database?.close(); } finally {
      if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith("vera-t14-upgrade-"))
        throw new Error("Unsafe fixture cleanup");
      rmSync(temp, { recursive: true, force: true });
    }
  }
}, 90_000);
