import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { PrismaService } from "../database/prisma.service";
import { AssignmentAccessService } from "./assignment-access.service";
import { transitionReviewAssignment } from "./review-assignment-transition";
import { draftPatch, observationPost, requireDurationBounds, requireSubmittableReview, reviewId, reviewSubmit } from "./review-draft.validation";

const projection = {
  id: true, version: true, summary: true, limitations: true,
  observations: { orderBy: [{ startMs: "asc" }, { id: "asc" }], select: {
    id: true, category: true, startMs: true, endMs: true, observation: true, context: true,
  } },
} satisfies Prisma.ExpertReviewSelect;

function missing(): never {
  throw new NotFoundException({ code: "REVIEW_NOT_FOUND", message: "Review draft not found." });
}

function conflict(): never {
  throw new ConflictException({ code: "REVIEW_VERSION_CONFLICT", message: "The draft changed. Reload it before saving again." });
}

export function reviewStateConflict(): never {
  throw new ConflictException({ code: "REVIEW_STATE_CONFLICT", message: "The current review state does not allow this action. Reload the review." });
}

@Injectable()
export class ReviewDraftService {
  constructor(private readonly prisma: PrismaService, private readonly access: AssignmentAccessService) {}

  private async assignmentFor(auth: AuthContext, id: string) {
    const locator = await this.prisma.expertReview.findFirst({
      where: { id, assignment: { expertId: auth.user.id } }, select: { assignmentId: true },
    }).catch(() => {
      throw new ServiceUnavailableException({ code: "REVIEW_UNAVAILABLE", message: "The review could not be confirmed." });
    });
    if (!locator) missing();
    return locator.assignmentId;
  }

  read(auth: AuthContext, id: string, initialize = false) {
    return this.access.withAuthorizedAssignment(auth, reviewId(id), async (tx, access) => {
      const where = { assignmentId: access.assignmentId };
      const existing = await tx.expertReview.findUnique({ where, select: { ...projection, status: true, submittedAt: true } });
      if (existing?.submittedAt && existing.status === "SUBMITTED" && access.assignment.status === "SUBMITTED") {
        if (initialize) reviewStateConflict();
        await access.validateTime();
        return { draft: null, submission: { id: existing.id, status: existing.status, version: existing.version,
          submittedAt: existing.submittedAt }, durationMs: null };
      }
      if ((existing && existing.status !== "DRAFT") || !["ASSIGNED", "IN_PROGRESS"].includes(access.assignment.status)) missing();
      const draft = existing ?? (initialize ? await tx.expertReview.create({
        data: where, select: projection,
      }) : null);
      await tx.auditLog.create({ data: { actorId: auth.user.id, subjectType: "ExpertAssignment",
        subjectId: id, action: initialize && !existing ? "EXPERT_DRAFT_CREATED" : "EXPERT_DRAFT_READ" } });
      await access.validateTime();
      return { draft: draft && { id: draft.id, version: draft.version, summary: draft.summary,
        limitations: draft.limitations, observations: draft.observations,
      }, durationMs: access.video.durationMs };
    }, "review");
  }

  async save(auth: AuthContext, rawId: string, input: unknown, append = false) {
    this.access.requireRuntimeExpert(auth);
    const id = reviewId(rawId);
    const patch = append ? undefined : draftPatch(input);
    const entry = append ? observationPost(input) : undefined;
    const expectedVersion = (patch ?? entry!).expectedVersion;
    const assignmentId = await this.assignmentFor(auth, id);
    return this.access.withAuthorizedAssignment(auth, assignmentId, async (tx, access) => {
      if (!["ASSIGNED", "IN_PROGRESS"].includes(access.assignment.status)) reviewStateConflict();
      const where = { id, assignmentId: access.assignmentId };
      const current = await tx.expertReview.findFirst({ where, select: { version: true, status: true } });
      if (!current) missing();
      if (current.version !== expectedVersion || current.version === 2147483647) conflict();
      if (current.status !== "DRAFT") reviewStateConflict();
      const observations = entry ? [entry.observation] : patch?.observations;
      if (observations) requireDurationBounds(observations, access.video.durationMs, append ? "observation" : "observations");
      await access.validateTime();
      const updated = await tx.expertReview.updateMany({ where: { ...where, version: expectedVersion, status: current.status },
        data: { version: { increment: 1 }, summary: patch?.summary, limitations: patch?.limitations } });
      if (updated.count !== 1) conflict();
      if (patch?.observations !== undefined) await tx.expertObservation.deleteMany({ where: { reviewId: id } });
      if (observations?.length) await tx.expertObservation.createMany({
        data: observations.map(row => ({ ...row, reviewId: id })),
      });
      await tx.auditLog.create({ data: { actorId: auth.user.id, subjectType: "ExpertReview",
        subjectId: id, action: "EXPERT_DRAFT_SAVED" } });
      const draft = await tx.expertReview.findUniqueOrThrow({ where: { id }, select: projection });
      await access.validateTime();
      return { draft, durationMs: access.video.durationMs };
    }, "review");
  }

  async submit(auth: AuthContext, rawId: string, input: unknown) {
    this.access.requireRuntimeExpert(auth);
    const id = reviewId(rawId);
    const expectedVersion = reviewSubmit(input);
    const assignmentId = await this.assignmentFor(auth, id);
    return this.access.withAuthorizedAssignment(auth, assignmentId, async (tx, access) => {
      const where = { id, assignmentId };
      const review = await tx.expertReview.findFirst({ where, select: {
        summary: true, limitations: true, version: true, status: true, submittedAt: true,
        observations: { orderBy: [{ startMs: "asc" }, { id: "asc" }], select: {
          category: true, startMs: true, endMs: true, observation: true, context: true,
        } },
      } });
      if (!review) missing();
      if (review.status === "SUBMITTED" && access.assignment.status === "SUBMITTED" && review.submittedAt &&
        review.version === expectedVersion + 1) {
        await access.validateTime();
        return { id, status: "SUBMITTED" as const, version: review.version, submittedAt: review.submittedAt };
      }
      if (review.version !== expectedVersion || review.version === 2147483647) conflict();
      if (review.status !== "DRAFT" || !["ASSIGNED", "IN_PROGRESS"].includes(access.assignment.status)) reviewStateConflict();
      requireSubmittableReview(review, access.video.durationMs);
      const { now } = await access.validateTime();
      const changed = await tx.expertReview.updateMany({ where: { ...where, version: expectedVersion, status: review.status },
        data: { status: "SUBMITTED", version: { increment: 1 }, submittedAt: now, qaAt: null, qaById: null, qaFeedback: null } });
      if (changed.count !== 1) conflict();
      const assignment = access.assignment.status === "ASSIGNED"
        ? await transitionReviewAssignment(tx, access.assignment, "IN_PROGRESS", auth.user.id)
        : access.assignment;
      await transitionReviewAssignment(tx, assignment, "SUBMITTED", auth.user.id);
      await tx.auditLog.create({ data: { actorId: auth.user.id, subjectType: "ExpertReview", subjectId: id, action: "EXPERT_REVIEW_SUBMITTED" } });
      await access.validateTime();
      return { id, status: "SUBMITTED" as const, version: expectedVersion + 1, submittedAt: now };
    }, "review");
  }
}
