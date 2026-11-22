import { BadRequestException } from "@nestjs/common";
import { record, reviewId, version } from "./review-draft.validation";

export const factualStatements = {
  INTEREST_READING: "The member said they enjoy reading.",
  INTEREST_COOKING: "The member said they enjoy cooking.",
  INTEREST_HIKING: "The member said they enjoy hiking.",
  INTEREST_MUSIC: "The member said they enjoy music.",
  INTEREST_GARDENING: "The member said they enjoy gardening.",
  INTEREST_VOLUNTEERING: "The member said they enjoy volunteering.",
} as const;

export type FactualStatement = keyof typeof factualStatements;
const maxClaims = Object.keys(factualStatements).length;

export function isFactualStatement(value: unknown): value is FactualStatement {
  return typeof value === "string" && Object.hasOwn(factualStatements, value);
}

export function reviewInputError(field: string, message: string): never {
  throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Check the review fields.",
    details: [{ field, messages: [message] }] });
}

export function privateText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.includes("\u0000") || !value.trim() || value.trim().length > max)
    reviewInputError(field, `Enter between 1 and ${max} characters.`);
  return value.trim();
}

function claimRevision(expectedRevision: unknown) {
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 || expectedRevision >= 2147483647)
    reviewInputError("expectedRevision", "Send the current claim revision.");
  return expectedRevision;
}

export function claimFeedback(input: unknown) {
  const { target, note, expectedRevision } = record(input, ["target", "note", "expectedRevision"]);
  if (target !== "TRANSCRIPT" && target !== "CONTEXT")
    reviewInputError("target", "Select the transcript or context.");
  return { target, note: privateText(note, "note", 2000), expectedRevision: claimRevision(expectedRevision) } as const;
}

export function claimUpdate(input: unknown): { action: "CONFIRM" | "SHARE" | "REVOKE"; expectedRevision: number } {
  const { action, expectedRevision } = record(input, ["action", "expectedRevision"]);
  const revision = claimRevision(expectedRevision);
  if (action !== "CONFIRM" && action !== "SHARE" && action !== "REVOKE")
    reviewInputError("action", "Select a supported claim action.");
  return { action, expectedRevision: revision };
}

function identifier(value: unknown, field: string) {
  if (typeof value !== "string") reviewInputError(field, "Send a valid reference.");
  return reviewId(value);
}

export function reviewApproval(input: unknown) {
  const body = record(input, ["expectedVersion", "claims"]);
  const expectedVersion = version(body.expectedVersion);
  const claims = body.claims === undefined ? [] : body.claims;
  if (!Array.isArray(claims) || claims.length > maxClaims)
    reviewInputError("claims", `Select at most ${maxClaims} factual statements.`);
  const seen = new Set<FactualStatement>();
  return { expectedVersion, claims: claims.map((item, index) => {
    const field = `claims.${index}`;
    const row = record(item, ["type", "observationId", "context", "transcript"], field);
    const type = row.type;
    if (!isFactualStatement(type) || seen.has(type)) reviewInputError(field + ".type", "Select a distinct factual statement.");
    seen.add(type);
    return {
      type, observationId: identifier(row.observationId, field + ".observationId"),
      context: privateText(row.context, field + ".context", 1000),
      transcript: row.transcript === undefined ? null : privateText(row.transcript, field + ".transcript", 2000),
    };
  }) };
}

export function approvedClaimRows(
  claims: ReturnType<typeof reviewApproval>["claims"],
  observations: readonly { id: string; category: string; startMs: number; endMs: number }[],
  ownerId: string,
  reviewId: string,
  reviewVersion: number,
) {
  return claims.map((claim, index) => {
    const source = observations.find(row => row.id === claim.observationId && row.category === "SPEECH");
    if (!source) reviewInputError(`claims.${index}.observationId`, "Use a speech observation from the submitted version.");
    return {
      ownerId, reviewId, reviewVersion, claimType: claim.type, claimText: factualStatements[claim.type],
      sourceObservationId: source.id, sourceCategory: "SPEECH" as const,
      sourceStartMs: source.startMs, sourceEndMs: source.endMs, transcript: claim.transcript, context: claim.context,
      qaApproved: true, ownerConfirmed: false, shareApproved: false,
    };
  });
}
