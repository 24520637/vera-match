import { ForbiddenException } from "@nestjs/common";
import type { AuthContext } from "../auth/auth-context";
import type { ConsentAccessService } from "../consent/consent-access.service";
import type { SafetyAccessService } from "../safety/safety-access.service";
import { ReviewOwnerService } from "./review-owner.service";

describe("C059 owner review reports", () => {
  const auth: AuthContext = { sessionId: "session", user: { id: "owner", role: "MEMBER", email: "owner@example.invalid", displayName: null } };
  const now = new Date("2026-01-02T00:00:00Z");
  const uploadedAt = new Date("2026-01-01T00:00:00Z");

  function setup() {
    const row = { id: "review", version: 4, summary: "A pause during the first question.", limitations: "One prompted session.",
      qaAt: now, qaById: "moderator", qaFeedback: "Private feedback", observations: [{ observation: "Private note" }],
      decisions: [{ version: 4, moderatorId: "moderator", decidedAt: now }],
      assignment: { expertId: "expert", cancelledAt: null, reviewConsentSubjectId: "consent", reviewConsentVersion: 1n,
        expert: { displayName: "Synthetic reviewer" }, video: { id: "video", ownerId: "owner", createdAt: uploadedAt, status: "READY",
          bucket: "private", objectKey: "private-key", deletedAt: null, storageConsentVersion: 1n } } };
    const tx = {
      expertReview: { findMany: jest.fn(async () => [row]) },
      block: { count: jest.fn(async () => 0) },
      auditLog: { create: jest.fn() },
      session: { findUnique: jest.fn(async () => ({ expiresAt: new Date(now.getTime() + 60000) })) },
      $queryRaw: jest.fn(async () => [{ now }]),
    };
    const consent = { requireInTransaction: jest.fn(async () => ({ subjectId: "consent" })),
      requireGenerationInTransaction: jest.fn(async () => undefined) };
    const access = { run: jest.fn(async (_auth, _role, _peers, action) => action(tx, now)) };
    const service = new ReviewOwnerService(access as unknown as SafetyAccessService, consent as unknown as ConsentAccessService);
    return { service, row, tx, consent };
  }

  it("restricts the database query to approved reports and exposes a narrow projection", async () => {
    const { service, tx } = setup();
    await expect(service.list(auth)).resolves.toEqual({ reports: [{
      id: "review", summary: "A pause during the first question.", limitations: "One prompted session.",
      approvedAt: now, reviewer: "Synthetic reviewer", source: { videoId: "video", uploadedAt },
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
});
