import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createAuthDatabase } from "./disposable-auth-database";
import { actor, assign, seedExpert } from "./expert-db-fixtures";

/** Persistence invariants only. No fixture claims trusted ADMIN provisioning or
 * real MFA; no production grant service, queue authorization or endpoint exists.
 */
describe("C035 PA2 grant persistence / disposable PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>;
  beforeAll(async () => { db = await createAuthDatabase(); }, 60000);
  afterAll(async () => { await db?.close(); });
  async function fixture() {
    const seed = await seedExpert(db.client), assignment = await assign(db.client, seed);
    const identity = await db.client.expertActorIdentity.create({ data: { userId: seed.moderator.id } });
    const scope = await db.client.assignmentModeratorScope.create({ data: {
      assignmentId: assignment.id, moderatorSubjectId: identity.subjectId } });
    return { seed, assignment, identity, scope };
  }
  async function future() {
    const [row] = await db.client.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() + interval '1 hour' AS at`;
    return row.at;
  }
  async function grant(tx: Prisma.TransactionClient, scopeId: string, expectedRevision: bigint, expiresAt: Date, createdAt?: Date) {
    const before = await tx.assignmentModeratorScope.findUniqueOrThrow({ where: { id: scopeId } });
    const id = randomUUID();
    const changed = await tx.assignmentModeratorScope.updateMany({ where: { id: scopeId, revision: expectedRevision },
      data: { currentGrantId: id, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new Error("RESOURCE_REVISION_CONFLICT");
    return tx.assignmentModeratorGrantEvent.create({ data: { id, grantId: id, scopeId,
      revision: expectedRevision + 1n, kind: "GRANTED", fromGrantId: before.currentGrantId, expiresAt, actorEvidence: actor, createdAt } });
  }
  async function revoke(tx: Prisma.TransactionClient, scopeId: string, expectedRevision: bigint, createdAt?: Date) {
    const before = await tx.assignmentModeratorScope.findUniqueOrThrow({ where: { id: scopeId } });
    if (before.revision !== expectedRevision || !before.currentGrantId) throw new Error("RESOURCE_REVISION_CONFLICT");
    const origin = await tx.assignmentModeratorGrantEvent.findUniqueOrThrow({ where: { id: before.currentGrantId! } });
    const changed = await tx.assignmentModeratorScope.updateMany({ where: { id: scopeId, revision: expectedRevision },
      data: { currentGrantId: null, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new Error("RESOURCE_REVISION_CONFLICT");
    return tx.assignmentModeratorGrantEvent.create({ data: { grantId: origin.id, scopeId,
      revision: expectedRevision + 1n, kind: "REVOKED", fromGrantId: origin.id, expiresAt: origin.expiresAt, actorEvidence: actor, createdAt } });
  }
  it("starts without authority; rejects duplicate pairs, missing assignment identity and revision resets", async () => {
    const f = await fixture();
    expect(f.scope).toMatchObject({ currentGrantId: null, revision: 0n });
    await expect(db.client.assignmentModeratorScope.create({ data: { assignmentId: f.assignment.id,
      moderatorSubjectId: f.identity.subjectId } })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.client.assignmentModeratorScope.create({ data: { assignmentId: "missing", moderatorSubjectId: randomUUID() } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.client.assignmentModeratorScope.update({ where: { id: f.scope.id }, data: { revision: 2n } })).rejects.toThrow("revision must advance once");
    await expect(db.client.assignmentModeratorScope.delete({ where: { id: f.scope.id } })).rejects.toThrow("append-only");
    await expect(db.client.$executeRawUnsafe('TRUNCATE "AssignmentModeratorScope" CASCADE')).rejects.toThrow("append-only");
  });
  it("records grant/revoke atomically; regrant is a distinct immutable lifecycle", async () => {
    const f = await fixture(), expiresAt = await future();
    const original = await db.client.$transaction(tx => grant(tx, f.scope.id, 0n, expiresAt));
    const revoked = await db.client.$transaction(tx => revoke(tx, f.scope.id, 1n));
    const next = await db.client.$transaction(tx => grant(tx, f.scope.id, 2n, expiresAt));
    expect(next.id).not.toBe(original.id);
    expect(revoked).toMatchObject({ grantId: original.id, revision: 2n, kind: "REVOKED", expiresAt });
    expect(await db.client.assignmentModeratorScope.findUnique({ where: { id: f.scope.id } })).toMatchObject({ revision: 3n, currentGrantId: next.id });
    expect(await db.client.assignmentModeratorGrantEvent.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await db.client.assignmentModeratorGrantEvent.count({ where: { scopeId: f.scope.id } })).toBe(3);
    await expect(db.client.assignmentModeratorScope.update({ where: { id: f.scope.id }, data: { currentGrantId: original.id, revision: 4n } })).rejects.toThrow("Historical grants cannot be reactivated");
    await expect(db.client.assignmentModeratorGrantEvent.update({ where: { id: original.id }, data: { expiresAt } })).rejects.toThrow("append-only");
    await expect(db.client.assignmentModeratorGrantEvent.delete({ where: { id: revoked.id } })).rejects.toThrow("append-only");
    await expect(db.client.$executeRawUnsafe('TRUNCATE "AssignmentModeratorGrantEvent" CASCADE')).rejects.toThrow("append-only");
  });
  it("requires non-null finite future database expiry and rolls back rejected grants", async () => {
    const f = await fixture(), expiresAt = await future();
    for (const value of [null, new Date("2000-01-01T00:00:00Z"), "infinity"]) {
      await expect(db.client.$transaction(async tx => {
        const id = randomUUID();
        await tx.assignmentModeratorScope.update({ where: { id: f.scope.id }, data: { currentGrantId: id, revision: 1n } });
        await tx.$executeRaw`INSERT INTO "AssignmentModeratorGrantEvent"
          (id,"scopeId",revision,kind,"grantId","expiresAt","actorEvidence")
          VALUES (${id}::uuid,${f.scope.id}::uuid,1,'GRANTED',${id}::uuid,${value}::timestamptz,${JSON.stringify(actor)}::jsonb)`;
      })).rejects.toMatchObject({ code: "P2010", meta: { code: value === null ? "23502" : "23514" } });
      expect(await db.client.assignmentModeratorScope.findUnique({ where: { id: f.scope.id } })).toMatchObject({ revision: 0n, currentGrantId: null });
    }
    expect(await db.client.assignmentModeratorGrantEvent.count({ where: { scopeId: f.scope.id } })).toBe(0);
    const original = await db.client.$transaction(tx => grant(tx, f.scope.id, 0n, expiresAt));
    await expect(db.client.assignmentModeratorScope.update({ where: { id: f.scope.id },
      data: { currentGrantId: null, revision: 2n } })).rejects.toThrow("Matching grant event required at commit");
    expect(await db.client.assignmentModeratorScope.findUnique({ where: { id: f.scope.id } })).toMatchObject({ revision: 1n, currentGrantId: original.id });
  });
  it("rejects unrevoked valid grant replacement; expired lifecycle permits a new ID only", async () => {
    const f = await fixture(), expiry = await future();
    await db.client.$transaction(tx => grant(tx, f.scope.id, 0n, expiry));
    await expect(db.client.$transaction(tx => grant(tx, f.scope.id, 1n, expiry))).rejects.toThrow("Revoke an unexpired grant");
    const other = await fixture();
    const old = await db.client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3s'");
      const [clock] = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() + interval '400 milliseconds' AS at`;
      const first = await grant(tx, other.scope.id, 0n, clock.at);
      await tx.$queryRaw`SELECT true AS elapsed FROM pg_sleep(0.5)`;
      return first;
    }, { timeout: 5000 });
    const next = await db.client.$transaction(tx => grant(tx, other.scope.id, 1n, expiry));
    expect(next.id).not.toBe(old.id);
    expect(next.fromGrantId).toBe(old.id);
    expect(await db.client.assignmentModeratorGrantEvent.findUnique({ where: { id: old.id } })).toEqual(old);
  });
  it("rejects fabricated events and missing matching events without partial state", async () => {
    const f = await fixture(), expiresAt = await future(), id = randomUUID();
    await expect(db.client.assignmentModeratorGrantEvent.create({ data: { id, grantId: id, scopeId: f.scope.id,
      revision: 1n, kind: "GRANTED", expiresAt, actorEvidence: actor } })).rejects.toThrow("matching scope mutation");
    await expect(db.client.assignmentModeratorScope.update({ where: { id: f.scope.id }, data: { currentGrantId: id, revision: 1n } })).rejects.toThrow();
    await expect(db.client.$transaction(async tx => {
      await tx.assignmentModeratorScope.update({ where: { id: f.scope.id }, data: { currentGrantId: id, revision: 1n } });
      await tx.assignmentModeratorGrantEvent.create({ data: { id, grantId: id, scopeId: f.scope.id,
        revision: 1n, kind: "GRANTED", fromGrantId: randomUUID(), expiresAt, actorEvidence: actor } });
    })).rejects.toThrow("matching scope mutation");
    expect(await db.client.assignmentModeratorScope.findUnique({ where: { id: f.scope.id } })).toMatchObject({ currentGrantId: null, revision: 0n });
    expect(await db.client.assignmentModeratorGrantEvent.count({ where: { scopeId: f.scope.id } })).toBe(0);
  });
  it("checks revocation origin, expiry and same-scope binding with otherwise valid mutations", async () => {
    const f = await fixture(), other = await fixture(), expiresAt = await future();
    const first = await db.client.$transaction(tx => grant(tx, f.scope.id, 0n, expiresAt));
    const foreign = await db.client.$transaction(tx => grant(tx, other.scope.id, 0n, expiresAt));
    for (const override of [{ grantId: foreign.id }, { expiresAt: new Date(expiresAt.getTime() + 1000) }]) {
      await expect(db.client.$transaction(async tx => {
        await tx.assignmentModeratorScope.update({ where: { id: f.scope.id }, data: { currentGrantId: null, revision: 2n } });
        await tx.assignmentModeratorGrantEvent.create({ data: { scopeId: f.scope.id, revision: 2n, kind: "REVOKED",
          grantId: first.id, fromGrantId: first.id, expiresAt, actorEvidence: actor, ...override } });
      })).rejects.toThrow("Revocation must retain the original lifecycle");
    }
    expect(await db.client.assignmentModeratorScope.findUnique({ where: { id: f.scope.id } })).toMatchObject({ revision: 1n, currentGrantId: first.id });
  });
  it("allows exactly one concurrent first grant and one concurrent CAS revocation", async () => {
    const f = await fixture(), expiresAt = await future();
    const results = await Promise.allSettled([0, 1].map(() => db.client.$transaction(tx => grant(tx, f.scope.id, 0n, expiresAt))));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.message).toBe("RESOURCE_REVISION_CONFLICT");
    const revoked = await Promise.allSettled([0, 1].map(() => db.client.$transaction(tx => revoke(tx, f.scope.id, 1n))));
    expect(revoked.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((revoked.find(r => r.status === "rejected") as PromiseRejectedResult).reason.message).toBe("RESOURCE_REVISION_CONFLICT");
    expect(await db.client.assignmentModeratorGrantEvent.count({ where: { scopeId: f.scope.id } })).toBe(2);
    expect(await db.client.assignmentModeratorScope.findUnique({ where: { id: f.scope.id } })).toMatchObject({ revision: 2n, currentGrantId: null });
  });
  it("rolls back state and history after a later transaction failure", async () => {
    const f = await fixture(), expiresAt = await future();
    await expect(db.client.$transaction(async tx => { await grant(tx, f.scope.id, 0n, expiresAt); throw new Error("Synthetic final failure"); })).rejects.toThrow("Synthetic final failure");
    expect(await db.client.assignmentModeratorScope.findUnique({ where: { id: f.scope.id } })).toMatchObject({ revision: 0n, currentGrantId: null });
    expect(await db.client.assignmentModeratorGrantEvent.count({ where: { scopeId: f.scope.id } })).toBe(0);
  });
  it.each(["2000-01-01", "2099-01-01"])("overrides caller recording time %s on valid grant/revoke inserts", async forged => {
    const f = await fixture(), expiresAt = await future();
    for (const kind of ["GRANTED", "REVOKED"] as const) {
      const event = await db.client.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3s'");
        await tx.$queryRaw`SELECT true AS elapsed FROM pg_sleep(0.05)`;
        const [before] = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
        const current = kind === "GRANTED" ? await grant(tx, f.scope.id, 0n, expiresAt, new Date(forged)) :
          await revoke(tx, f.scope.id, 1n, new Date(forged));
        const [after] = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
        expect(current.createdAt.getTime()).toBeGreaterThanOrEqual(before.at.getTime() - 1);
        expect(current.createdAt.getTime()).toBeLessThanOrEqual(after.at.getTime() + 1);
        return current;
      });
      expect(event.createdAt.getUTCFullYear()).not.toBe(new Date(forged).getUTCFullYear());
    }
  });
  it("retains history and scope through real Video/User deletion without retaining the live actor mapping", async () => {
    const f = await fixture(), expiresAt = await future();
    const event = await db.client.$transaction(tx => grant(tx, f.scope.id, 0n, expiresAt));
    await db.client.video.delete({ where: { id: f.seed.video.id } });
    await db.client.user.delete({ where: { id: f.seed.moderator.id } });
    expect(await db.client.expertAssignment.findUnique({ where: { id: f.assignment.id } })).toBeNull();
    expect(await db.client.expertActorIdentity.findUnique({ where: { userId: f.seed.moderator.id } })).toBeNull();
    expect(await db.client.assignmentModeratorScope.findUnique({ where: { id: f.scope.id } })).toMatchObject({ moderatorSubjectId: f.identity.subjectId });
    expect(await db.client.assignmentModeratorGrantEvent.findUnique({ where: { id: event.id } })).toEqual(event);
    expect(await db.client.expertAssignmentIdentity.findUnique({ where: { assignmentId: f.assignment.id } })).not.toBeNull();
    // A recreated account has a new subject and cannot inherit the retained scope.
    await db.client.user.create({ data: { id: f.seed.moderator.id, email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-only", role: "MODERATOR" } });
    const identity = await db.client.expertActorIdentity.create({ data: { userId: f.seed.moderator.id } });
    expect(identity.subjectId).not.toBe(f.identity.subjectId);
    expect(await db.client.assignmentModeratorScope.count({ where: { moderatorSubjectId: identity.subjectId } })).toBe(0);
  });
});
