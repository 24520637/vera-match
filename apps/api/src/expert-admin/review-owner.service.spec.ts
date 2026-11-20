import { ForbiddenException } from "@nestjs/common";
import type { AuthContext } from "../auth/auth-context";
import type { ConsentAccessService } from "../consent/consent-access.service";
import type { SafetyAccessService } from "../safety/safety-access.service";
import { ReviewOwnerService } from "./review-owner.service";

describe("C059 owner review reports", () => {
  const auth: AuthContext = { sessionId: "session", user: { id: "owner", role: "MEMBER", email: "owner@example.invalid", displayName: null } };
  const now = new Date("2026-01-02T00:00:00Z");
  const uploadedAt = new Date("2026-01-01T00:00:00Z");
  const claim = {
    id: "claim", claimType: "INTEREST_READING", claimText: "The member said they enjoy reading.",
    qaApproved: true, ownerId: "owner", reviewVersion: 4, sourceObservationId: "speech", sourceCategory: "SPEECH",
    sourceStartMs: 100, sourceEndMs: 2000, context: "Hobbies", transcript: "I enjoy reading." as string | null,
    revision: 0, ownerConfirmed: false, shareApproved: false, revokedAt: null as Date | null,
    shareConsentSubjectId: null as string | null, shareConsentVersion: null as bigint | null,
    feedback: [],
  };

  function setup() {
    const row = { id: "review", version: 4, summary: "A pause during the first question.", limitations: "One prompted session.",
      qaAt: now, qaById: "moderator", qaFeedback: "Private feedback", observations: [{ observation: "Private note" }],
      decisions: [{ version: 4, moderatorId: "moderator", decidedAt: now }], claims: [] as Array<typeof claim>, disputes: [],
      assignment: { expertId: "expert", cancelledAt: null, reviewConsentSubjectId: "consent", reviewConsentVersion: 1n,
        expert: { displayName: "Synthetic reviewer" }, video: { id: "video", ownerId: "owner", createdAt: uploadedAt, status: "READY",
          bucket: "private", objectKey: "private-key", deletedAt: null, storageConsentVersion: 1n } } };
    const tx = {
      expertReview: { findMany: jest.fn(async () => [row]), findFirst: jest.fn(async () => row) },
      reviewClaim: { findFirst: jest.fn(async () => ({ ...claim, review: row })), updateMany: jest.fn(async () => ({ count: 1 })) },
      reviewClaimFeedback: {
        findUnique: jest.fn<Promise<{ target: string; note: string; revision: number; updatedAt: Date } | null>, []>(async () => null),
        upsert: jest.fn(async () => ({ target: "TRANSCRIPT", note: "I said someone else enjoys reading.", revision: 1, updatedAt: now })),
      },
      reviewDispute: { count: jest.fn(async () => 0), create: jest.fn(async () => ({ id: "dispute", status: "OPEN" })) },
      block: { count: jest.fn(async () => 0) },
      auditLog: { create: jest.fn() },
      session: { findUnique: jest.fn(async () => ({ expiresAt: new Date(now.getTime() + 60000) })) },
      $queryRaw: jest.fn(async () => [{ now }]),
    };
    const consent = { requireInTransaction: jest.fn(async () => ({ subjectId: "consent", version: 8n })),
      requireGenerationInTransaction: jest.fn(async () => undefined) };
    const access = { run: jest.fn(async (_auth, _role, _peers, action) => action(tx, now)) };
    const service = new ReviewOwnerService(access as unknown as SafetyAccessService, consent as unknown as ConsentAccessService);
    return { service, row, tx, consent };
  }

  it("restricts the database query to approved reports and exposes a narrow projection", async () => {
    const { service, tx } = setup();
    await expect(service.list(auth)).resolves.toEqual({ reports: [{
      id: "review", summary: "A pause during the first question.", limitations: "One prompted session.",
      approvedAt: now, reviewer: "Synthetic reviewer", source: { videoId: "video", uploadedAt }, claims: [], disputes: [],
    }], nextCursor: null });
    expect(tx.expertReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      status: "APPROVED", assignment: expect.objectContaining({ status: "COMPLETED", video: expect.objectContaining({ ownerId: "owner" }) }),
    }) }));
  });

  it("hides reports without independent approval provenance or belonging to another member", async () => {
    const { service, row } = setup();
    row.decisions[0].version = 3;
    await expect(service.list(auth)).resolves.toEqual({ reports: [], nextCursor: null });
    row.decisions[0].version = 4;
    row.assignment.video.ownerId = "another-member";
    await expect(service.list(auth)).resolves.toEqual({ reports: [], nextCursor: null });
  });

  it("omits reports after a source generation withdrawal even when current consent was granted again", async () => {
    const { service, consent } = setup();
    consent.requireGenerationInTransaction.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.list(auth)).resolves.toEqual({ reports: [], nextCursor: null });
  });

  it("projects the claim evidence for its owner and omits unverifiable claims", async () => {
    const { service, row } = setup();
    row.claims = [claim, { ...claim, id: "old", reviewVersion: 2 }, { ...claim, id: "foreign", ownerId: "foreign" }];
    const { reports } = await service.list(auth);
    expect(reports[0].claims).toEqual([{
      id: "claim", type: "INTEREST_READING", statement: claim.claimText,
      evidence: { startMs: 100, endMs: 2000, context: "Hobbies", transcript: "I enjoy reading." },
      revision: 0, ownerConfirmed: false, shareApproved: false, revokedAt: null, feedback: [],
    }]);
  });

  it("saves private transcript feedback and returns the existing annotation on retry", async () => {
    const { service, tx } = setup();
    const note = "I said someone else enjoys reading.";
    const input = { target: "TRANSCRIPT", note: ` ${note} `, expectedRevision: 0 };
    const feedback = { target: "TRANSCRIPT", note, revision: 1, updatedAt: now };
    await expect(service.saveFeedback(auth, "claim", input)).resolves.toEqual({ feedback });
    expect(tx.reviewClaimFeedback.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { claimId: "claim", target: "TRANSCRIPT", note },
    }));
    tx.reviewClaimFeedback.findUnique.mockResolvedValue(feedback);
    await expect(service.saveFeedback(auth, "claim", input)).resolves.toEqual({ feedback });
    await expect(service.saveFeedback(auth, "claim", { ...input, note: "Different note" })).rejects.toMatchObject({ status: 409 });
    expect(tx.reviewClaimFeedback.upsert).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: { actorId: "owner", subjectType: "ReviewClaim",
      subjectId: "claim", action: "REVIEW_CLAIM_FEEDBACK_SAVED" } });
    expect(tx.reviewClaim.updateMany).not.toHaveBeenCalled();
  });

  it("denies feedback for another owner, an unapproved version, or a missing transcript", async () => {
    const { service, row, tx } = setup();
    const input = { target: "TRANSCRIPT", note: "A private note.", expectedRevision: 0 };
    row.assignment.video.ownerId = "foreign";
    await expect(service.saveFeedback(auth, "claim", input)).rejects.toMatchObject({ status: 404 });
    row.assignment.video.ownerId = "owner";
    row.decisions[0].version = 3;
    await expect(service.saveFeedback(auth, "claim", input)).rejects.toMatchObject({ status: 404 });
    row.decisions[0].version = 4;
    tx.reviewClaim.findFirst.mockResolvedValue({ ...claim, review: row, transcript: null });
    await expect(service.saveFeedback(auth, "claim", input)).rejects.toMatchObject({ status: 400 });
    expect(tx.reviewClaimFeedback.upsert).not.toHaveBeenCalled();
  });

  it("confirms a single claim with a revision check and keeps sharing disabled", async () => {
    const { service, tx } = setup();
    await expect(service.updateClaim(auth, "claim", { action: "CONFIRM", expectedRevision: 1 })).rejects.toMatchObject({ status: 409 });
    expect(tx.reviewClaim.updateMany).not.toHaveBeenCalled();
    await expect(service.updateClaim(auth, "claim", { action: "CONFIRM", expectedRevision: 0 }))
      .resolves.toMatchObject({ claim: { ownerConfirmed: true, shareApproved: false, revision: 1 } });
    expect(tx.reviewClaim.updateMany).toHaveBeenCalledWith({
      where: { id: "claim", ownerId: "owner", revision: 0 }, data: { ownerConfirmed: true, revision: 1 },
    });
  });

  it("returns 404 for a claim whose source owner differs from the caller", async () => {
    const { service, row, tx } = setup();
    row.assignment.video.ownerId = "foreign";
    await expect(service.updateClaim(auth, "claim", { action: "CONFIRM", expectedRevision: 0 })).rejects.toMatchObject({ status: 404 });
    expect(tx.reviewClaim.updateMany).not.toHaveBeenCalled();
  });

  it("shares only a confirmed claim and binds the current consent generation", async () => {
    const { service, row, tx, consent } = setup();
    await expect(service.updateClaim(auth, "claim", { action: "SHARE", expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
    expect(tx.reviewClaim.updateMany).not.toHaveBeenCalled();
    tx.reviewClaim.findFirst.mockResolvedValue({ ...claim, review: row, ownerConfirmed: true, revision: 1 });
    consent.requireInTransaction.mockResolvedValueOnce({ subjectId: "consent", version: 8n })
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(service.updateClaim(auth, "claim", { action: "SHARE", expectedRevision: 1 })).rejects.toMatchObject({ status: 403 });
    expect(tx.reviewClaim.updateMany).not.toHaveBeenCalled();
    await expect(service.updateClaim(auth, "claim", { action: "SHARE", expectedRevision: 1 }))
      .resolves.toMatchObject({ claim: { ownerConfirmed: true, shareApproved: true, revision: 2 } });
    expect(consent.requireInTransaction).toHaveBeenLastCalledWith(tx, "owner", ["PROFILE_MATCHING", "REPORT_SHARING", "VIDEO_CLAIM_MATCHING"]);
    expect(tx.reviewClaim.updateMany).toHaveBeenCalledWith({
      where: { id: "claim", ownerId: "owner", revision: 1 },
      data: { shareApproved: true, shareConsentSubjectId: "consent", shareConsentVersion: 8n, revision: 2 },
    });
  });

  it("shows a withdrawn consent generation as unshared and allows individual revocation", async () => {
    const { service, row, tx, consent } = setup();
    const shared = { ...claim, ownerConfirmed: true, shareApproved: true, revision: 2,
      shareConsentSubjectId: "consent", shareConsentVersion: 4n };
    row.claims = [shared];
    consent.requireGenerationInTransaction.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException());
    const { reports } = await service.list(auth);
    expect(reports[0].claims[0].shareApproved).toBe(false);
    tx.reviewClaim.findFirst.mockResolvedValue({ ...shared, review: row });
    await expect(service.updateClaim(auth, "claim", { action: "REVOKE", expectedRevision: 2 }))
      .resolves.toMatchObject({ claim: { shareApproved: false, revokedAt: now, revision: 3 } });
    expect(tx.reviewClaim.updateMany).toHaveBeenLastCalledWith({
      where: { id: "claim", ownerId: "owner", revision: 2 },
      data: { shareApproved: false, revokedAt: now, shareConsentSubjectId: null, shareConsentVersion: null, revision: 3 },
    });
    tx.reviewClaim.findFirst.mockResolvedValue({ ...shared, review: row, revokedAt: now, revision: 3 });
    await expect(service.updateClaim(auth, "claim", { action: "SHARE", expectedRevision: 3 })).rejects.toMatchObject({ status: 409 });
  });

  it("opens a private dispute tied to the report version and optional claim", async () => {
    const { service, tx } = setup();
    await expect(service.openDispute(auth, "review", { claimId: "claim", reason: " I said something else. " }))
      .resolves.toEqual({ dispute: { id: "dispute", status: "OPEN" } });
    expect(tx.reviewClaim.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "claim", reviewId: "review", ownerId: "owner" } }));
    expect(tx.reviewDispute.create).toHaveBeenCalledWith(expect.objectContaining({ data: {
      ownerId: "owner", reviewId: "review", reviewVersion: 4, claimId: "claim", reason: "I said something else.",
    } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: { actorId: "owner", subjectType: "ReviewDispute",
      subjectId: "dispute", action: "REVIEW_DISPUTE_OPENED" } });
  });

  it("rejects duplicate open disputes and disputes against another member's report", async () => {
    const { service, tx, row } = setup();
    tx.reviewDispute.count.mockResolvedValue(1);
    await expect(service.openDispute(auth, "review", { reason: "Duplicate." })).rejects.toMatchObject({ status: 409 });
    row.assignment.video.ownerId = "foreign";
    await expect(service.openDispute(auth, "review", { reason: "Foreign." })).rejects.toMatchObject({ status: 404 });
    expect(tx.reviewDispute.create).not.toHaveBeenCalled();
  });
});
