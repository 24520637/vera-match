import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { privateText, reviewInputError } from "./review-claim.validation";
import { record, reviewId } from "./review-draft.validation";

export const disputeSelect = {
  id: true, claimId: true, reason: true, status: true, resolution: true, revision: true,
  createdAt: true, inReviewAt: true, resolvedAt: true,
} satisfies Prisma.ReviewDisputeSelect;

export function disputeInput(input: unknown) {
  const { reason, claimId } = record(input, ["reason", "claimId"]);
  if (claimId !== undefined && typeof claimId !== "string") reviewInputError("claimId", "Send a valid claim identifier.");
  return { reason: privateText(reason, "reason", 2000), claimId: claimId === undefined ? null : reviewId(claimId) };
}

export function disputeDecision(input: unknown): {
  expectedRevision: number; status: "IN_REVIEW" | "RESOLVED" | "REJECTED"; resolution: string | null;
} {
  const { status, expectedRevision, resolution } = record(input, ["status", "expectedRevision", "resolution"]);
  if (expectedRevision !== 0 && expectedRevision !== 1) reviewInputError("expectedRevision", "Send the current dispute revision.");
  if (status !== "IN_REVIEW" && status !== "RESOLVED" && status !== "REJECTED")
    reviewInputError("status", "Select a supported dispute status.");
  if (status === "IN_REVIEW" && resolution !== undefined) reviewInputError("resolution", "Send a response when closing the dispute.");
  return { expectedRevision, status, resolution: status === "IN_REVIEW" ? null : privateText(resolution, "resolution", 2000) };
}

export function disputeConflict(): never {
  throw new ConflictException({ code: "REVIEW_DISPUTE_CONFLICT", message: "The dispute state changed. Reload the report or case." });
}
