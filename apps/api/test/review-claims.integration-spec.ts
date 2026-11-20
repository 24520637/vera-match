import { ConsentPurpose, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AuthContext } from "../src/auth/auth-context";
import type { EnvironmentService } from "../src/config/environment.service";
import { ConsentAccessService } from "../src/consent/consent-access.service";
import { consentPurposes, type ConsentPolicyRegistry } from "../src/consent/consent.policy";
import { ConsentService } from "../src/consent/consent.service";
import type { PrismaService } from "../src/database/prisma.service";
import { AssignmentGrantsService } from "../src/expert-admin/assignment-grants.service";
import { readMatchingClaimsInTransaction } from "../src/expert-admin/review-matching-claims";
import { ReviewOwnerService } from "../src/expert-admin/review-owner.service";
import { ReviewQaService } from "../src/expert-admin/review-qa.service";
import { SafetyAccessService } from "../src/safety/safety-access.service";
import type { StaffAssuranceSource } from "../src/safety/staff-assurance.source";
import { createAuthDatabase } from "./disposable-auth-database";
import { actor, assignmentEvent, seedExpert, transition } from "./expert-db-fixtures";

describe("T12 review claims and disputes / disposable PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>;
  beforeAll(async () => { db = await createAuthDatabase(); }, 60_000);
  afterAll(async () => { await db?.close(); });

  const policyVersion = "synthetic-t12-policy";
  const environment = { values: { nodeEnv: "test" } } as EnvironmentService;
  const registry: ConsentPolicyRegistry = { current: purpose => ({
    purpose, policyVersion, locale: "en", content: "Synthetic test consent policy.", testOnly: true,
  }) };
  const assurance: StaffAssuranceSource = { resolve: async (_tx, auth) => ({
    userId: auth.user.id, sessionId: auth.sessionId, level: "MFA", verifiedAt: new Date(0),
    expiresAt: new Date(Date.now() + 600_000), testOnly: true,
  }) };

  async function login(id: string): Promise<AuthContext> {
    const user = await db.client.user.update({ where: { id }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });
    const session = await db.client.session.create({ data: { userId: id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 600_000) } });
    return { sessionId: session.id, user };
  }

  async function user(role: UserRole) {
    const row = await db.client.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-only", role } });
    return login(row.id);
  }

  it("commits QA evidence, scopes disputes and removes claims at the matching read boundary", async () => {
    const client = db.client as unknown as PrismaService;
    const consent = new ConsentAccessService(client, environment);
    const consentService = new ConsentService(client, registry, environment);
    const access = new SafetyAccessService(client);
    const qa = new ReviewQaService(client, access, assurance, environment, consent);
    const ownerService = new ReviewOwnerService(access, consent);
    const grants = new AssignmentGrantsService(client, environment, { resolve: async (_tx, auth) => ({
      userId: auth.user.id, role: "ADMIN", active: true, reference: "synthetic-t12", testOnly: true,
    }) }, assurance);
    const seed = await seedExpert(db.client);
    const moderator = await login(seed.moderator.id);
    const owner = await user("MEMBER");
    const stranger = await user("MEMBER");
    const admin = await user("ADMIN");
    function patchConsent(auth: AuthContext, expectedVersion: number, purposes: ConsentPurpose[], granted: boolean) {
      return consentService.patch(auth.user.id, { expectedVersion, consents: purposes.map(purpose => ({
        purpose, granted, ...(granted ? { policyVersion } : {}),
      })) }, randomUUID());
    }
    await patchConsent(owner, 0, consentPurposes, true);
    await patchConsent(stranger, 0, ["PROFILE_MATCHING"], true);
    const generation = await db.client.consentLedger.findUniqueOrThrow({ where: { userId: owner.user.id } });
    const video = await db.client.video.create({ data: { ownerId: owner.user.id, bucket: "synthetic-private", objectKey: randomUUID(),
      mimeType: "video/mp4", status: "READY", durationMs: 5000, storageConsentVersion: generation.version } });
    const assignment = await db.client.$transaction(async tx => {
      const row = await tx.expertAssignment.create({ data: { videoId: video.id, expertId: seed.expert.id,
        assignedById: moderator.user.id, assignedByEvidence: actor, credentialApprovalId: seed.approval.id,
        reviewConsentSubjectId: generation.subjectId, reviewConsentVersion: generation.version } });
      await assignmentEvent(tx, row.id, null);
      return row;
    });
    const grant = await grants.grant(admin, { assignmentId: assignment.id, moderatorId: moderator.user.id, expectedRevision: 0,
      expiresAt: new Date(Date.now() + 600_000).toISOString() });
    await transition(db.client, assignment.id, 0n, "IN_PROGRESS");
    await transition(db.client, assignment.id, 1n, "SUBMITTED");
    const review = await db.client.expertReview.create({ data: { assignmentId: assignment.id, status: "SUBMITTED", version: 2,
      submittedAt: new Date(), summary: "The member discussed hobbies.", limitations: "One recording.", observations: { create: {
        category: "SPEECH", startMs: 100, endMs: 900, observation: "The member mentioned reading.", context: "Hobbies prompt.",
      } } }, include: { observations: true } });
    const approval = { expectedVersion: 2, claims: [{ type: "INTEREST_READING", observationId: review.observations[0].id,
      context: "Hobbies prompt.", transcript: "I enjoy reading." }] };
    await expect(ownerService.list(owner)).resolves.toEqual({ reports: [], nextCursor: null });
    const decisions = await Promise.allSettled([qa.approve(moderator, review.id, approval), qa.approve(moderator, review.id, approval)]);
    expect(decisions.filter(decision => decision.status === "fulfilled")).toHaveLength(1);
    expect(decisions.find(decision => decision.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    const claim = await db.client.reviewClaim.findFirstOrThrow({ where: { reviewId: review.id } });
    expect(await db.client.reviewClaim.count({ where: { reviewId: review.id } })).toBe(1);
    expect(claim).toMatchObject({ reviewVersion: 3, ownerConfirmed: false, shareApproved: false, sourceEndMs: 900 });
    await db.client.reviewClaim.create({ data: { reviewId: review.id, claimType: "INTEREST_READING", claimText: claim.claimText,
      qaApproved: true, ownerConfirmed: true, shareApproved: true } });
    await expect(ownerService.list(owner)).resolves.toMatchObject({ reports: [{ claims: [{ id: claim.id }] }] });
    await expect(ownerService.list(stranger)).resolves.toEqual({ reports: [], nextCursor: null });
    await expect(ownerService.updateClaim(stranger, claim.id, { action: "CONFIRM", expectedRevision: 0 })).rejects.toMatchObject({ status: 404 });
    const feedbackInput = { target: "CONTEXT", note: "It was a question about weekend hobbies.", expectedRevision: 0 };
    await expect(ownerService.saveFeedback(stranger, claim.id, feedbackInput)).rejects.toMatchObject({ status: 404 });
    await expect(ownerService.saveFeedback(owner, claim.id, feedbackInput)).resolves.toMatchObject({
      feedback: { target: "CONTEXT", note: feedbackInput.note, revision: 1 },
    });
    await expect(ownerService.list(owner)).resolves.toMatchObject({ reports: [{ claims: [{
      feedback: [{ target: "CONTEXT", note: feedbackInput.note, revision: 1 }], ownerConfirmed: false, shareApproved: false,
    }] }] });
    const matching = () => db.client.$transaction(tx => readMatchingClaimsInTransaction(tx, consent, stranger.user.id, owner.user.id));
    await expect(matching()).resolves.toEqual([]);
    await ownerService.updateClaim(owner, claim.id, { action: "CONFIRM", expectedRevision: 0 });
    await expect(matching()).resolves.toEqual([]);
    await ownerService.updateClaim(owner, claim.id, { action: "SHARE", expectedRevision: 1 });
    await expect(matching()).resolves.toEqual([{ type: "INTEREST_READING", statement: claim.claimText }]);
    await expect(ownerService.openDispute(stranger, review.id, { reason: "Foreign report." })).rejects.toMatchObject({ status: 404 });
    const opened = await Promise.allSettled([
      ownerService.openDispute(owner, review.id, { claimId: claim.id, reason: "Check the transcript." }),
      ownerService.openDispute(owner, review.id, { claimId: claim.id, reason: "Check the transcript." }),
    ]);
    const win = opened.find(outcome => outcome.status === "fulfilled");
    if (!win) throw new Error("Expected one dispute to open");
    expect(opened.find(outcome => outcome.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    const dispute = win.value.dispute;
    await expect(matching()).resolves.toEqual([]);
    await expect(qa.readDispute(moderator, dispute.id)).resolves.toMatchObject({ report: null, claim: {
      statement: claim.claimText, evidence: { transcript: "I enjoy reading." },
    } });
    await expect(qa.listDisputes(moderator)).resolves.toMatchObject({ disputes: [{ id: dispute.id }] });
    const unassigned = await user("MODERATOR");
    await expect(qa.readDispute(unassigned, dispute.id)).rejects.toMatchObject({ status: 404 });
    await expect(qa.decideDispute(unassigned, dispute.id, { expectedRevision: 0, status: "IN_REVIEW" })).rejects.toMatchObject({ status: 404 });
    await qa.decideDispute(moderator, dispute.id, { expectedRevision: 0, status: "IN_REVIEW" });
    await qa.decideDispute(moderator, dispute.id, { expectedRevision: 1, status: "REJECTED", resolution: "The recording supports the claim." });
    await expect(matching()).resolves.toHaveLength(1);
    expect(await db.client.expertReview.findUnique({ where: { id: review.id } })).toMatchObject({ version: 3, status: "APPROVED" });
    await patchConsent(owner, Number(generation.version), ["VIDEO_CLAIM_MATCHING"], false);
    await expect(matching()).resolves.toEqual([]);
    await patchConsent(owner, Number(generation.version) + 1, ["VIDEO_CLAIM_MATCHING"], true);
    await expect(matching()).resolves.toEqual([]);
    await ownerService.updateClaim(owner, claim.id, { action: "SHARE", expectedRevision: 2 });
    await expect(matching()).resolves.toHaveLength(1);

    const { dispute: entireReport } = await ownerService.openDispute(owner, review.id, { reason: "Check the report summary." });
    await expect(qa.readDispute(moderator, entireReport.id)).resolves.toEqual({
      dispute: entireReport, reviewId: review.id, claim: null,
      report: { version: 3, summary: review.summary, limitations: review.limitations, approvedAt: expect.any(Date) },
    });
    await expect(qa.readDispute(moderator, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(qa.readDispute(stranger, entireReport.id)).rejects.toMatchObject({ status: 403 });
    await expect(qa.readDispute(unassigned, entireReport.id)).rejects.toMatchObject({ status: 404 });
    await qa.decideDispute(moderator, entireReport.id, { expectedRevision: 0, status: "IN_REVIEW" });
    const uphold = { expectedRevision: 1, status: "RESOLVED", resolution: "The report omits an important limitation." };
    await grants.revoke(admin, { scopeId: grant.scopeId, grantId: grant.grantId, expectedRevision: grant.revision });
    await expect(qa.readDispute(moderator, entireReport.id)).rejects.toMatchObject({ status: 404 });
    await expect(qa.decideDispute(moderator, entireReport.id, uphold)).rejects.toMatchObject({ status: 404 });
    await grants.grant(admin, { assignmentId: assignment.id, moderatorId: moderator.user.id, expectedRevision: grant.revision + 1,
      expiresAt: new Date(Date.now() + 600_000).toISOString() });
    await expect(qa.decideDispute(moderator, entireReport.id, uphold)).resolves.toMatchObject({ dispute: { status: "RESOLVED" } });
    await expect(matching()).resolves.toEqual([]);

    await ownerService.updateClaim(owner, claim.id, { action: "REVOKE", expectedRevision: 3 });
    await expect(matching()).resolves.toEqual([]);
  });
});
