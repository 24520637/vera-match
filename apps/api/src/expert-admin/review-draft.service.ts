import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { PrismaService } from "../database/prisma.service";
import { AssignmentAccessService } from "./assignment-access.service";
import { draftPatch, observationPost, requireDurationBounds, reviewId } from "./review-draft.validation";

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

@Injectable()
export class ReviewDraftService {
  constructor(private readonly prisma: PrismaService, private readonly access: AssignmentAccessService) {}

  read(auth: AuthContext, id: string, initialize = false) {
    return this.access.withAuthorizedAssignment(auth, reviewId(id), async (tx, access) => {
      const where = { assignmentId: access.assignmentId };
      const existing = await tx.expertReview.findUnique({ where, select: { ...projection, status: true } });
      if (existing && existing.status !== "DRAFT") missing();
      const draft = existing ?? (initialize ? await tx.expertReview.create({
        data: where, select: projection,
      }) : null);
      await tx.auditLog.create({ data: { actorId: auth.user.id, subjectType: "ExpertAssignment",
        subjectId: id, action: initialize && !existing ? "EXPERT_DRAFT_CREATED" : "EXPERT_DRAFT_READ" } });
      await access.validateTime();
      return { draft: draft && { id: draft.id, version: draft.version, summary: draft.summary,
        limitations: draft.limitations, observations: draft.observations }, durationMs: access.video.durationMs };
    });
  }

  async save(auth: AuthContext, rawId: string, input: unknown, append = false) {
    this.access.requireRuntimeExpert(auth);
    const id = reviewId(rawId);
    const patch = append ? undefined : draftPatch(input);
    const entry = append ? observationPost(input) : undefined;
    const expectedVersion = (patch ?? entry!).expectedVersion;
    // Locator metadata authorizes nothing. Filter by owner even before the locked
    // recheck so foreign and nonexistent review IDs get the same response.
    const locator = await this.prisma.expertReview.findFirst({
      where: { id, assignment: { expertId: auth.user.id } }, select: { assignmentId: true },
    }).catch(() => {
      throw new ServiceUnavailableException({ code: "REVIEW_UNAVAILABLE", message: "The draft could not be confirmed." });
    });
    if (!locator) missing();
    return this.access.withAuthorizedAssignment(auth, locator.assignmentId, async (tx, access) => {
      const where = { id, assignmentId: access.assignmentId, status: "DRAFT" as const };
      const current = await tx.expertReview.findFirst({ where, select: { version: true } });
      if (!current) missing();
      if (current.version !== expectedVersion || current.version === 2147483647) conflict();
      const observations = entry ? [entry.observation] : patch?.observations;
      if (observations) requireDurationBounds(observations, access.video.durationMs, append ? "observation" : "observations");
      await access.validateTime();
      const updated = await tx.expertReview.updateMany({ where: { ...where, version: expectedVersion },
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
    });
  }
}
