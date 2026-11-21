import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ConsentAccessService } from "../consent/consent-access.service";
import { readMatchingClaimsInTransaction } from "./review-matching-claims";

describe("T12 matching claim eligibility", () => {
  const now = new Date("2026-01-02T12:00:00Z");

  function setup() {
    const review = {
      id: "review", version: 4, summary: "Synthetic summary.", limitations: "One recording.", qaById: "qa", qaAt: now,
      decisions: [{ version: 4, moderatorId: "qa", decidedAt: now }],
      disputes: [] as Array<{ claimId: string | null; reviewVersion: number }>,
      assignment: { expertId: "expert", cancelledAt: null, reviewConsentSubjectId: "ledger", reviewConsentVersion: 1n,
        video: { ownerId: "candidate", status: "READY", deletedAt: null, storageConsentVersion: 1n } },
    };
    const claim = {
      id: "claim", reviewVersion: 4, claimType: "INTEREST_READING", claimText: "The member said they enjoy reading.",
      ownerConfirmed: true, shareApproved: true, revokedAt: null as Date | null,
      sourceObservationId: "speech", sourceStartMs: 1, sourceEndMs: 2,
      shareConsentSubjectId: "ledger", shareConsentVersion: 3n, review, transcript: "Private test transcript.",
    };
    const tx = { $queryRaw: jest.fn(), block: { count: jest.fn(async () => 0) },
      reviewClaim: { findMany: jest.fn(async () => [claim]) },
      expertObservation: { findFirst: jest.fn<Promise<{ id: string } | null>, []>(async () => ({ id: "speech" })) } };
    const consent = { requireInTransaction: jest.fn(async () => ({ subjectId: "ledger", version: 3n })),
      requireGenerationInTransaction: jest.fn(async () => undefined) };
    const read = () => readMatchingClaimsInTransaction(tx as unknown as Prisma.TransactionClient,
      consent as unknown as ConsentAccessService, "viewer", "candidate");
    return { tx, consent, claim, review, read };
  }

  it("applies both member scopes and projects only canonical claim types and statements", async () => {
    const { read, tx, consent } = setup();
    await expect(read()).resolves.toEqual([{ type: "INTEREST_READING", statement: "The member said they enjoy reading." }]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.reviewClaim.findMany.mock.invocationCallOrder[0]);
    expect(tx.reviewClaim.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: "candidate", qaApproved: true, ownerConfirmed: true, shareApproved: true, revokedAt: null }),
    }));
    expect(consent.requireInTransaction).toHaveBeenCalledWith(tx, "viewer", ["PROFILE_MATCHING"]);
    expect(consent.requireInTransaction).toHaveBeenCalledWith(tx, "candidate", ["PROFILE_MATCHING", "REPORT_SHARING", "VIDEO_CLAIM_MATCHING"]);
    expect(tx.expertObservation.findFirst).toHaveBeenCalledWith({ where: {
      id: "speech", reviewId: "review", category: "SPEECH", startMs: 1, endMs: 2,
    }, select: { id: true } });
    tx.expertObservation.findFirst.mockResolvedValueOnce(null);
    await expect(read()).resolves.toEqual([]);
  });

  it("excludes revoked, withdrawn, subjective, stale and disputed claims", async () => {
    const { read, claim, review, consent } = setup();
    for (const change of [{ revokedAt: now }, { ownerConfirmed: false }, { shareApproved: false },
      { claimText: "Subjective statement" }, { reviewVersion: 2 }]) {
      const previous = { ...claim };
      Object.assign(claim, change);
      await expect(read()).resolves.toEqual([]);
      Object.assign(claim, previous);
    }
    consent.requireGenerationInTransaction.mockRejectedValueOnce(new ForbiddenException());
    await expect(read()).resolves.toEqual([]);
    for (const claimId of [null, claim.id]) {
      review.disputes = [{ claimId, reviewVersion: 4 }];
      await expect(read()).resolves.toEqual([]);
    }
    review.disputes = [{ claimId: "another-claim", reviewVersion: 4 }];
    await expect(read()).resolves.toHaveLength(1);
    review.decisions[0].moderatorId = "expert";
    await expect(read()).resolves.toEqual([]);
  });

  it("excludes blocked pairs and unavailable source video", async () => {
    const { read, tx, review } = setup();
    tx.block.count.mockResolvedValueOnce(1);
    await expect(read()).resolves.toEqual([]);
    expect(tx.reviewClaim.findMany).not.toHaveBeenCalled();
    review.assignment.video.status = "DELETED";
    await expect(read()).resolves.toEqual([]);
  });
});
