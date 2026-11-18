import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createAuthDatabase } from "./disposable-auth-database";
import { actor, assign, assignmentEvent, seedExpert } from "./expert-db-fixtures";

/** C036 database acceptance only. These transactions are fixtures, not a worker,
 * authorization mechanism or a cancellation/reassignment HTTP implementation.
 */
describe("C036 cancellation and replacement database races", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>;
  beforeAll(async () => { db = await createAuthDatabase(); }, 60000);
  afterAll(async () => { await db?.close(); });
  function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
  }
  async function contention(blocker: number) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const rows = await db.client.$queryRaw<{ pid: number }[]>`SELECT a.pid FROM pg_stat_activity a
        WHERE a.datname=current_database() AND a.wait_event_type='Lock'
          AND ${blocker}=ANY(pg_blocking_pids(a.pid))
          AND position('ExpertAssignment' IN a.query)>0
          AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='"ExpertAssignment"'::regclass)`;
      if (rows.length) return rows;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Expected assignment lock contention was not observed");
  }
  async function mutate(tx: Prisma.TransactionClient, id: string, status: "CANCELLED" | "IN_PROGRESS") {
    const changed = await tx.expertAssignment.updateMany({ where: { id, revision: 0n },
      data: { status, revision: { increment: 1 }, cancelledAt: status === "CANCELLED" ? new Date() : null } });
    if (changed.count !== 1) throw new Error("RESOURCE_REVISION_CONFLICT");
    await assignmentEvent(tx, id, "ASSIGNED");
  }
  async function replacement(tx: Prisma.TransactionClient, seed: Awaited<ReturnType<typeof seedExpert>>, id: string = randomUUID()) {
    const row = await tx.expertAssignment.create({ data: { id, videoId: seed.video.id, expertId: seed.expert.id,
      assignedById: seed.moderator.id, assignedByEvidence: actor, credentialApprovalId: seed.approval.id } });
    await assignmentEvent(tx, row.id, null);
    return row;
  }
  it.each(["CANCELLED", "IN_PROGRESS"] as const)("proves %s wins before the stale competing CAS can commit", async status => {
    const seed = await seedExpert(db.client), row = await assign(db.client, seed);
    const entered = gate(), finish = gate(); let pid = 0;
    const winner = db.client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await mutate(tx, row.id, status);
      [pid] = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`).map(r => r.pid);
      entered.release(); await finish.promise;
      return status;
    }, { timeout: 15000 });
    const observedWinner = winner.then(value => ({ value }), error => ({ error }));
    let loser: Promise<unknown> | undefined;
    try {
      await Promise.race([entered.promise, winner]);
      loser = db.client.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await mutate(tx, row.id, status === "CANCELLED" ? "IN_PROGRESS" : "CANCELLED");
      }, { timeout: 15000 }).then(() => ({ committed: true }), error => ({ error }));
      expect((await contention(pid)).length).toBe(1);
      finish.release();
      expect(await observedWinner).toEqual({ value: status });
      expect(await loser).toMatchObject({ error: { message: "RESOURCE_REVISION_CONFLICT" } });
      expect(await db.client.expertAssignment.findUnique({ where: { id: row.id } })).toMatchObject({ status, revision: 1n });
      const events = await db.client.assignmentEvent.findMany({ where: { assignmentId: row.id }, orderBy: { revision: "asc" } });
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({ revision: 1n, fromStatus: "ASSIGNED", toStatus: status });
      expect(events[1].snapshot).toMatchObject({ id: row.id, status, revision: 1 });
    } finally { finish.release(); await Promise.allSettled([winner, ...(loser ? [loser] : [])]); }
  });
  it("rolls back cancellation and replacement reservations when the deferred replacement event is missing", async () => {
    const seed = await seedExpert(db.client), old = await assign(db.client, seed), id = randomUUID();
    const before = await db.client.expertAssignment.findUniqueOrThrow({ where: { id: old.id } });
    const events = await db.client.assignmentEvent.findMany({ where: { assignmentId: old.id } });
    let reachedCommit = false;
    await expect(db.client.$transaction(async tx => {
      await mutate(tx, old.id, "CANCELLED");
      await tx.expertAssignment.create({ data: { id, videoId: seed.video.id, expertId: seed.expert.id,
        assignedById: seed.moderator.id, assignedByEvidence: actor, credentialApprovalId: seed.approval.id } });
      expect(await tx.expertAssignmentIdentity.findUnique({ where: { assignmentId: id } })).not.toBeNull();
      expect(await tx.assignmentEvent.count({ where: { assignmentId: old.id } })).toBe(2);
      reachedCommit = true;
      // Deliberately omit ONLY the replacement event: the real deferred constraint
      // must reject COMMIT after all rows and the old cancellation event exist.
    })).rejects.toThrow("Matching assignment event required in transaction");
    expect(reachedCommit).toBe(true);
    expect(await db.client.expertAssignment.findUnique({ where: { id: old.id } })).toEqual(before);
    expect(await db.client.assignmentEvent.findMany({ where: { assignmentId: old.id } })).toEqual(events);
    expect(await db.client.expertAssignment.findUnique({ where: { id } })).toBeNull();
    expect(await db.client.expertAssignmentIdentity.findUnique({ where: { assignmentId: id } })).toBeNull();
    expect(await db.client.assignmentEvent.count({ where: { assignmentId: id } })).toBe(0);
    // The rolled-back ID reservation can be used by the next valid transaction.
    await db.client.$transaction(async tx => { await mutate(tx, old.id, "CANCELLED"); await replacement(tx, seed, id); });
    expect(await db.client.expertAssignment.count({ where: { videoId: seed.video.id, status: "ASSIGNED" } })).toBe(1);
  });
  it("observes concurrent replacement contention and retains exactly one complete replacement history", async () => {
    const seed = await seedExpert(db.client), old = await assign(db.client, seed), firstId = randomUUID(), secondId = randomUUID();
    const entered = gate(), finish = gate(); let pid = 0;
    const replace = (id: string, hold: boolean) => db.client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await mutate(tx, old.id, "CANCELLED");
      const next = await replacement(tx, seed, id);
      if (hold) { const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pid = backend.pid; entered.release(); await finish.promise; }
      return next.id;
    }, { timeout: 15000 });
    const winner = replace(firstId, true), observed = winner.then(value => ({ value }), error => ({ error }));
    let loser: Promise<unknown> | undefined;
    try {
      await Promise.race([entered.promise, winner]);
      loser = replace(secondId, false).then(value => ({ value }), error => ({ error }));
      expect((await contention(pid)).length).toBe(1); finish.release();
      expect(await observed).toEqual({ value: firstId });
      expect(await loser).toMatchObject({ error: { message: "RESOURCE_REVISION_CONFLICT" } });
      expect(await db.client.expertAssignment.findUnique({ where: { id: old.id } })).toMatchObject({ status: "CANCELLED", revision: 1n });
      expect(await db.client.expertAssignment.findMany({ where: { videoId: seed.video.id, status: { in: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] } }, select: { id: true } })).toEqual([{ id: firstId }]);
      const history = await db.client.assignmentEvent.findMany({ where: { assignmentId: { in: [old.id, firstId] } }, orderBy: [{ assignmentId: "asc" }, { revision: "asc" }] });
      expect(history).toHaveLength(3);
      expect(history.find(e => e.assignmentId === old.id && e.revision === 1n)).toMatchObject({ fromStatus: "ASSIGNED", toStatus: "CANCELLED" });
      expect(history.find(e => e.assignmentId === firstId)).toMatchObject({ revision: 0n, fromStatus: null, toStatus: "ASSIGNED" });
      expect(await db.client.expertAssignmentIdentity.findUnique({ where: { assignmentId: secondId } })).toBeNull();
      expect(await db.client.assignmentEvent.count({ where: { assignmentId: secondId } })).toBe(0);
      // Valid retained events, not malformed inserts, exercise append-only guards.
      await expect(db.client.assignmentEvent.update({ where: { id: history[0].id }, data: { actorEvidence: actor } })).rejects.toThrow("append-only");
      await expect(db.client.assignmentEvent.delete({ where: { id: history[0].id } })).rejects.toThrow("append-only");
      expect(await db.client.assignmentEvent.findMany({ where: { assignmentId: { in: [old.id, firstId] } }, orderBy: [{ assignmentId: "asc" }, { revision: "asc" }] })).toEqual(history);
    } finally { finish.release(); await Promise.allSettled([winner, ...(loser ? [loser] : [])]); }
  });
});
