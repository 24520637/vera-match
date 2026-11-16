import { createAuthDatabase } from "./disposable-auth-database";
import { Prisma } from "@prisma/client";
import { actor, approve, assign, assignmentEvent, credentialEvent, evidence, expectDatabaseError, seedExpert, transition } from "./expert-db-fixtures";

describe("C031 credential and assignment persistence", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>;
  beforeAll(async () => { db = await createAuthDatabase(); });
  afterAll(async () => { await db?.close(); });

  async function databaseTime(tx: Prisma.TransactionClient) {
    const [row] = await tx.$queryRaw<{ at: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS at`;
    return row.at;
  }
  async function checkRecordingTime(resource: "assignment" | "credential", supplied?: Date, delayed = false) {
    const seed = await seedExpert(db.client);
    const assignment = resource === "assignment" ? await assign(db.client, seed) : undefined;
    const result = await db.client.$transaction(async tx => {
      // Session-local only: recording time must remain UTC regardless of session timezone.
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Pacific/Honolulu'");
      const [start] = await tx.$queryRaw<{ at: Date }[]>`SELECT (transaction_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS at`;
      if (delayed) await tx.$queryRaw`SELECT true AS waited FROM pg_sleep(0.15)`;
      const before = await databaseTime(tx);
      let event;
      if (assignment) {
        await tx.expertAssignment.update({ where: { id: assignment.id, revision: 0n },
          data: { status: "IN_PROGRESS", revision: 1n } });
        await assignmentEvent(tx, assignment.id, "ASSIGNED", supplied);
        event = await tx.assignmentEvent.findUniqueOrThrow({ where: { assignmentId_revision: { assignmentId: assignment.id, revision: 1n } } });
      } else {
        const row = await tx.expertCredential.update({ where: { userId: seed.expert.id, revision: 1n },
          data: { status: "REVOKED", revokedAt: before, revision: 2n } });
        event = await credentialEvent(tx, row, "REVOKED", "Synthetic timestamp regression", supplied);
      }
      return { event, before, after: await databaseTime(tx), started: start.at };
    });
    // Assertions after COMMIT prove valid state/event mutation, not rejection by another guard.
    const stored = resource === "assignment"
      ? await db.client.assignmentEvent.findUniqueOrThrow({ where: { id: result.event.id } })
      : await db.client.expertCredentialEvent.findUniqueOrThrow({ where: { id: result.event.id } });
    expect(stored.createdAt).toEqual(result.event.createdAt);
    expect(stored.createdAt.getTime()).toBeGreaterThanOrEqual(result.before.getTime());
    expect(stored.createdAt.getTime()).toBeLessThanOrEqual(result.after.getTime());
    if (supplied) expect(stored.createdAt).not.toEqual(supplied);
    if (delayed) expect(stored.createdAt.getTime() - result.started.getTime()).toBeGreaterThanOrEqual(100);
    if (assignment) {
      expect(await db.client.expertAssignment.findUnique({ where: { id: assignment.id } })).toMatchObject({ status: "IN_PROGRESS", revision: 1n });
      expect(await db.client.assignmentEvent.count({ where: { assignmentId: assignment.id } })).toBe(2);
    } else {
      expect(await db.client.expertCredential.findUnique({ where: { userId: seed.expert.id } })).toMatchObject({ status: "REVOKED", revision: 2n });
      expect(await db.client.expertCredentialEvent.count({ where: { subjectId: seed.approval.subjectId } })).toBe(3);
    }
  }
  for (const resource of ["assignment", "credential"] as const) {
    it.each(["2000-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"])(
      `overrides caller recording time %s for a committed ${resource} mutation`, async value => {
        await checkRecordingTime(resource, new Date(value));
      });
    it(`records ${resource} event insertion time after a long transaction has started`, async () => {
      await checkRecordingTime(resource, undefined, true);
    });
  }

  it("creates one current credential with immutable versioned evidence and separate revision", async () => {
    const seed = await seedExpert(db.client);
    const current = await db.client.expertCredential.findUniqueOrThrow({ where: { userId: seed.expert.id } });
    expect(current).toMatchObject({ status: "APPROVED", revision: 1n, approvalId: seed.approval.id });
    expect(await db.client.expertCredentialEvent.count({ where: { subjectId: current.subjectId } })).toBe(2);
    await expect(db.client.expertCredential.create({ data: { userId: seed.expert.id } })).rejects.toThrow();
    expect(seed.approval).toMatchObject({ trainingVersion: "synthetic-training-v1", policyVersion: "synthetic-confidentiality-v1" });
  });

  it("enforces credential FK, approval subject binding and complete evidence", async () => {
    await expect(db.client.expertCredential.create({ data: { userId: "missing-user" } })).rejects.toThrow();
    const a = await seedExpert(db.client), b = await seedExpert(db.client);
    await expectDatabaseError(db.client.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "ExpertCredential" SET "approvalId"=${b.approval.id}::uuid, revision=revision+1 WHERE "userId"=${a.expert.id}`;
      const row = await tx.expertCredential.findUniqueOrThrow({ where: { userId: a.expert.id } });
      await credentialEvent(tx, row, "APPROVED");
    }), "Approval belongs to another credential subject");
    const { id: _id, ...stored } = a.approval;
    const approval = { ...stored, confidentialityEvidence: evidence(), verifiedByEvidence: actor, approvedByEvidence: actor };
    await expect(db.client.expertCredentialApproval.create({ data: { ...approval,
      trainingEvidence: { kind: "PRIVATE_REFERENCE", bucket: "private", objectKey: "https://public.invalid/evidence" } } })).rejects.toThrow();
    await expect(db.client.expertCredentialApproval.create({ data: { ...approval,
      trainingEvidence: { ...evidence(), sha256: "invalid" } } })).rejects.toThrow();
  });

  it("rejects update, delete and truncate of evidence and history", async () => {
    const seed = await seedExpert(db.client), row = await assign(db.client, seed);
    await expect(db.client.expertCredentialApproval.update({ where: { id: seed.approval.id }, data: { trainingVersion: "tampered" } })).rejects.toThrow();
    await expect(db.client.expertCredentialApproval.delete({ where: { id: seed.approval.id } })).rejects.toThrow();
    await expect(db.client.expertCredentialEvent.deleteMany({ where: { subjectId: seed.approval.subjectId } })).rejects.toThrow();
    await expect(db.client.assignmentEvent.updateMany({ where: { assignmentId: row.id }, data: { actorEvidence: actor } })).rejects.toThrow();
    await expect(db.client.assignmentEvent.deleteMany({ where: { assignmentId: row.id } })).rejects.toThrow();
    await expect(db.client.$executeRawUnsafe('TRUNCATE "AssignmentEvent"')).rejects.toThrow();
    await expect(db.client.$executeRawUnsafe('TRUNCATE "ExpertCredentialEvent"')).rejects.toThrow();
  });

  it("requires atomic credential state/revision/event writes and rolls back failures", async () => {
    const seed = await seedExpert(db.client);
    await expect(db.client.expertCredential.update({ where: { userId: seed.expert.id }, data: { revision: { increment: 1 } } })).rejects.toThrow();
    await expect(db.client.$transaction(async tx => {
      const next = await tx.expertCredential.update({ where: { userId: seed.expert.id },
        data: { status: "REVOKED", revokedAt: new Date(), revision: { increment: 1 } } });
      await credentialEvent(tx, next, "REVOKED", "Synthetic revocation");
      throw new Error("Injected failure");
    })).rejects.toThrow("Injected failure");
    expect(await db.client.expertCredential.findUnique({ where: { userId: seed.expert.id } })).toMatchObject({ status: "APPROVED", revision: 1n });
    expect(await db.client.expertCredentialEvent.count({ where: { subjectId: seed.approval.subjectId } })).toBe(2);
  });

  it("blocks credential DELETE/recreate and TRUNCATE revision resets while the user exists", async () => {
    const seed = await seedExpert(db.client);
    await expectDatabaseError(db.client.$transaction(async tx => {
      await tx.$executeRaw`DELETE FROM "ExpertCredential" WHERE "userId"=${seed.expert.id}`;
      const replacement = await tx.expertCredential.create({ data: { userId: seed.expert.id } });
      await credentialEvent(tx, replacement, "CREATED");
    }), "C031 live identity cannot be deleted independently of its user");
    await expectDatabaseError(db.client.$executeRawUnsafe('TRUNCATE "ExpertCredential"'), "C031 evidence is append-only");
    expect(await db.client.expertCredential.findUnique({ where: { userId: seed.expert.id } })).toMatchObject({
      subjectId: seed.approval.subjectId, revision: 1n, status: "APPROVED",
    });
  });

  it("retains independent training, confidentiality and verification events with versioned evidence", async () => {
    const seed = await seedExpert(db.client);
    for (const fields of [
      { kind: "TRAINING_RECORDED" as const, trainingVersion: "synthetic-training-v2" },
      { kind: "CONFIDENTIALITY_RECORDED" as const, policyVersion: "synthetic-confidentiality-v2" },
      { kind: "VERIFIED" as const, verifiedAt: new Date("2026-01-02T00:00:00Z") },
    ]) await db.client.$transaction(async tx => {
      const row = await tx.expertCredential.update({ where: { userId: seed.expert.id }, data: { revision: { increment: 1 } } });
      await tx.expertCredentialEvent.create({ data: { subjectId: row.subjectId, revision: row.revision,
        status: row.status, approvalId: row.approvalId, actorEvidence: actor, evidence: evidence(), ...fields } });
    });
    const events = await db.client.expertCredentialEvent.findMany({ where: { subjectId: seed.approval.subjectId }, orderBy: { revision: "asc" } });
    expect(events).toHaveLength(5);
    expect(events[2].trainingVersion).toBe("synthetic-training-v2");
    expect(events[3].policyVersion).toBe("synthetic-confidentiality-v2");
    expect(events[4]).toMatchObject({ actorEvidence: actor, verifiedAt: new Date("2026-01-02T00:00:00Z") });
    // Recording evidence does not silently replace an already bound approval instance.
    expect(await db.client.expertCredentialApproval.findUnique({ where: { id: seed.approval.id } })).toMatchObject({ trainingVersion: "synthetic-training-v1" });
  });

  it("rejects orphan events and serializes competing credential CAS mutations", async () => {
    const seed = await seedExpert(db.client);
    await expect(db.client.expertCredentialEvent.create({ data: { subjectId: seed.approval.subjectId, revision: 99n,
      kind: "VERIFIED", status: "APPROVED", approvalId: seed.approval.id, verifiedAt: new Date(), actorEvidence: actor, evidence: evidence() } })).rejects.toThrow();
    const write = () => db.client.$transaction(async tx => {
      const changed = await tx.expertCredential.updateMany({ where: { userId: seed.expert.id, revision: 1n }, data: { revision: { increment: 1 } } });
      if (changed.count !== 1) throw new Error("RESOURCE_REVISION_CONFLICT");
      const next = await tx.expertCredential.findUniqueOrThrow({ where: { userId: seed.expert.id } });
      await tx.expertCredentialEvent.create({ data: { subjectId: next.subjectId, revision: next.revision,
        status: next.status, approvalId: next.approvalId, kind: "VERIFIED", verifiedAt: new Date(), actorEvidence: actor, evidence: evidence() } });
    });
    const results = await Promise.allSettled([write(), write()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason.message).toBe("RESOURCE_REVISION_CONFLICT");
    expect(await db.client.expertCredentialEvent.count({ where: { subjectId: seed.approval.subjectId } })).toBe(3);
  });

  it("preserves revocation history and creates a distinct reapproval without reviving cancelled work", async () => {
    const seed = await seedExpert(db.client), row = await assign(db.client, seed);
    await transition(db.client, row.id, 0n, "CANCELLED");
    await db.client.$transaction(async tx => {
      const next = await tx.expertCredential.update({ where: { userId: seed.expert.id },
        data: { status: "REVOKED", revokedAt: new Date(), revision: { increment: 1 } } });
      await credentialEvent(tx, next, "REVOKED", "Synthetic training withdrawal");
    });
    await expect(db.client.$transaction(async tx => {
      const next = await tx.expertCredential.update({ where: { userId: seed.expert.id },
        data: { status: "APPROVED", revokedAt: null, revision: { increment: 1 } } });
      await credentialEvent(tx, next, "APPROVED");
    })).rejects.toThrow();
    const second = await approve(db.client, seed.expert.id);
    expect(second.id).not.toBe(seed.approval.id);
    expect(await db.client.expertCredential.findUnique({ where: { userId: seed.expert.id } })).toMatchObject({ revision: 3n });
    expect(await db.client.expertAssignment.findUnique({ where: { id: row.id } })).toMatchObject({ status: "CANCELLED", credentialApprovalId: seed.approval.id });
    expect(await db.client.expertCredentialEvent.findFirst({ where: { subjectId: seed.approval.subjectId, kind: "REVOKED" } })).toMatchObject({ reason: "Synthetic training withdrawal" });
  });

  it("records replacement training while revoked without reactivating historical approval", async () => {
    const seed = await seedExpert(db.client);
    await db.client.$transaction(async tx => {
      const next = await tx.expertCredential.update({ where: { userId: seed.expert.id },
        data: { status: "REVOKED", revokedAt: new Date(), revision: 2n } });
      await credentialEvent(tx, next, "REVOKED", "Synthetic expiry review");
    });
    await db.client.$transaction(async tx => {
      const row = await tx.expertCredential.update({ where: { userId: seed.expert.id }, data: { revision: 3n } });
      await tx.expertCredentialEvent.create({ data: { subjectId: row.subjectId, revision: row.revision,
        status: row.status, approvalId: row.approvalId, revokedAt: row.revokedAt, kind: "TRAINING_RECORDED",
        trainingVersion: "synthetic-training-v2", actorEvidence: actor, evidence: evidence() } });
    });
    expect(await db.client.expertCredential.findUnique({ where: { userId: seed.expert.id } })).toMatchObject({ status: "REVOKED", revision: 3n });
  });

  it("supports the approved lifecycle, QA return, independent revisions and terminal completion", async () => {
    const seed = await seedExpert(db.client), row = await assign(db.client, seed);
    await transition(db.client, row.id, 0n, "IN_PROGRESS");
    await transition(db.client, row.id, 1n, "SUBMITTED");
    await transition(db.client, row.id, 2n, "IN_PROGRESS");
    await transition(db.client, row.id, 3n, "SUBMITTED");
    await transition(db.client, row.id, 4n, "COMPLETED");
    await expect(transition(db.client, row.id, 5n, "IN_PROGRESS")).rejects.toThrow("Assignment is terminal");
    await expect(transition(db.client, row.id, 5n, "CANCELLED")).rejects.toThrow("Assignment is terminal");
    expect(await db.client.assignmentEvent.count({ where: { assignmentId: row.id } })).toBe(6);
    expect(await db.client.expertCredential.findUnique({ where: { userId: seed.expert.id } })).toMatchObject({ revision: 1n });
  });

  it.each(["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] as const)("cancels %s and rejects reopening", async status => {
    const seed = await seedExpert(db.client), row = await assign(db.client, seed);
    let revision = 0n;
    if (status !== "ASSIGNED") { await transition(db.client, row.id, revision++, "IN_PROGRESS"); }
    if (status === "SUBMITTED") { await transition(db.client, row.id, revision++, "SUBMITTED"); }
    await transition(db.client, row.id, revision, "CANCELLED");
    await expect(transition(db.client, row.id, revision + 1n, "ASSIGNED")).rejects.toThrow("Assignment is terminal");
  });

  it("rejects skipped transitions, revision jumps, binding changes and state without events", async () => {
    const seed = await seedExpert(db.client), row = await assign(db.client, seed);
    await expectDatabaseError(db.client.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "ExpertAssignment" SET status='SUBMITTED',revision=1 WHERE id=${row.id}`;
      await assignmentEvent(tx, row.id, "ASSIGNED");
    }), "Invalid assignment transition");
    await expectDatabaseError(db.client.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "ExpertAssignment" SET revision=2 WHERE id=${row.id}`;
      await assignmentEvent(tx, row.id, "ASSIGNED");
    }), "Assignment binding is immutable; revision must advance once");
    await expect(db.client.expertAssignment.update({ where: { id: row.id }, data: { revision: 1n, status: "IN_PROGRESS" } })).rejects.toThrow("Matching assignment event required");
    await expectDatabaseError(db.client.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "ExpertAssignment" SET revision=1,"credentialApprovalId"=NULL WHERE id=${row.id}`;
      await assignmentEvent(tx, row.id, "ASSIGNED");
    }), "Assignment binding is immutable; revision must advance once");
    expect(await db.client.expertAssignment.findUnique({ where: { id: row.id } })).toMatchObject({ revision: 0n, status: "ASSIGNED" });
  });

  it("enforces one active assignment in a real concurrent insert race", async () => {
    const seed = await seedExpert(db.client);
    const results = await Promise.allSettled([assign(db.client, seed), assign(db.client, seed)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason.code).toBe("P2002");
    expect(await db.client.expertAssignment.count({ where: { videoId: seed.video.id } })).toBe(1);
    const winner = results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof assign>>>;
    expect(await db.client.assignmentEvent.count({ where: { assignmentId: winner.value.id } })).toBe(1);
  });

  it("rejects missing video/actor FKs and mismatched approval bindings without partial history", async () => {
    const seed = await seedExpert(db.client), other = await seedExpert(db.client);
    for (const override of [{ videoId: "missing-video" }, { assignedById: "missing-actor" }, { credentialApprovalId: other.approval.id }]) {
      await expect(db.client.$transaction(async tx => {
        const row = await tx.expertAssignment.create({ data: { videoId: seed.video.id, expertId: seed.expert.id,
          assignedById: seed.moderator.id, assignedByEvidence: actor, credentialApprovalId: seed.approval.id, ...override } });
        await assignmentEvent(tx, row.id, null);
      })).rejects.toThrow();
    }
    expect(await db.client.expertAssignment.count({ where: { videoId: seed.video.id } })).toBe(0);
  });

  it("CAS lets only one concurrent transition commit and rejects stale retries", async () => {
    const seed = await seedExpert(db.client), row = await assign(db.client, seed);
    const results = await Promise.allSettled([transition(db.client, row.id, 0n, "IN_PROGRESS"), transition(db.client, row.id, 0n, "CANCELLED")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason.message).toBe("RESOURCE_REVISION_CONFLICT");
    const winner = results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof transition>>>;
    expect(await db.client.expertAssignment.findUnique({ where: { id: row.id } })).toMatchObject({ status: winner.value.status, revision: 1n });
    expect(await db.client.assignmentEvent.count({ where: { assignmentId: row.id } })).toBe(2);
    await expect(transition(db.client, row.id, 0n, "IN_PROGRESS")).rejects.toThrow("RESOURCE_REVISION_CONFLICT");
  });

  it("reassigns atomically, rolls back failed replacements and never reopens cancelled rows", async () => {
    const seed = await seedExpert(db.client), old = await assign(db.client, seed);
    const replace = (fail: boolean) => db.client.$transaction(async tx => {
      await tx.expertAssignment.update({ where: { id: old.id }, data: { status: "CANCELLED", cancelledAt: new Date(), revision: 1n } });
      await assignmentEvent(tx, old.id, "ASSIGNED");
      const next = await tx.expertAssignment.create({ data: { videoId: seed.video.id, expertId: seed.expert.id,
        assignedById: seed.moderator.id, assignedByEvidence: actor, credentialApprovalId: seed.approval.id } });
      await assignmentEvent(tx, next.id, null);
      if (fail) throw new Error("Replacement failed");
      return next;
    });
    await expect(replace(true)).rejects.toThrow("Replacement failed");
    expect(await db.client.expertAssignment.findUnique({ where: { id: old.id } })).toMatchObject({ status: "ASSIGNED", revision: 0n });
    const next = await replace(false);
    expect(next.id).not.toBe(old.id);
    await expect(transition(db.client, old.id, 1n, "IN_PROGRESS")).rejects.toThrow();
    expect(await db.client.expertAssignment.count({ where: { videoId: seed.video.id } })).toBe(2);
  });

  it("serializes simultaneous reassignments with exactly one replacement", async () => {
    const seed = await seedExpert(db.client), old = await assign(db.client, seed);
    const replace = () => db.client.$transaction(async tx => {
      const result = await tx.expertAssignment.updateMany({ where: { id: old.id, revision: 0n },
        data: { status: "CANCELLED", cancelledAt: new Date(), revision: 1n } });
      if (result.count !== 1) throw new Error("RESOURCE_REVISION_CONFLICT");
      await assignmentEvent(tx, old.id, "ASSIGNED");
      const row = await tx.expertAssignment.create({ data: { videoId: seed.video.id, expertId: seed.expert.id,
        assignedById: seed.moderator.id, assignedByEvidence: actor, credentialApprovalId: seed.approval.id } });
      await assignmentEvent(tx, row.id, null);
      return row;
    });
    const results = await Promise.allSettled([replace(), replace()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason.message).toBe("RESOURCE_REVISION_CONFLICT");
    const winner = results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof replace>>>;
    expect(await db.client.expertAssignment.findUnique({ where: { id: winner.value.id } })).toMatchObject({ status: "ASSIGNED", revision: 0n });
    expect(await db.client.expertAssignment.count({ where: { videoId: seed.video.id, status: "ASSIGNED" } })).toBe(1);
    expect(await db.client.assignmentEvent.count({ where: { assignmentId: old.id } })).toBe(2);
  });

  it("keeps dueAt independent of expiresAt and retains actor evidence after FK SET NULL", async () => {
    const seed = await seedExpert(db.client), row = await assign(db.client, seed);
    const dueAt = new Date("2020-01-01T00:00:00Z"), expiresAt = new Date("2099-01-01T00:00:00Z");
    await db.client.$transaction(async tx => {
      await tx.expertAssignment.update({ where: { id: row.id }, data: { dueAt, expiresAt, revision: 1n } });
      await assignmentEvent(tx, row.id, "ASSIGNED");
    });
    await db.client.user.delete({ where: { id: seed.moderator.id } });
    expect(await db.client.expertAssignment.findUnique({ where: { id: row.id } })).toMatchObject({
      assignedById: null, assignedByEvidence: actor, dueAt, expiresAt, revision: 1n });
  });

  it("preserves the existing video/review cascade without cascading new evidence", async () => {
    const seed = await seedExpert(db.client), row = await assign(db.client, seed);
    await db.client.expertReview.create({ data: { assignmentId: row.id } });
    await db.client.video.delete({ where: { id: seed.video.id } });
    expect(await db.client.expertAssignment.count({ where: { id: row.id } })).toBe(0);
    expect(await db.client.expertReview.count({ where: { assignmentId: row.id } })).toBe(0);
    await db.client.user.delete({ where: { id: seed.expert.id } });
    expect(await db.client.expertCredential.count({ where: { userId: seed.expert.id } })).toBe(0);
    expect(await db.client.expertCredentialApproval.count({ where: { id: seed.approval.id } })).toBe(1);
    expect(await db.client.expertCredentialEvent.count({ where: { subjectId: seed.approval.subjectId } })).toBe(2);
    expect(await db.client.assignmentEvent.count({ where: { assignmentId: row.id } })).toBe(1);
  });
});
