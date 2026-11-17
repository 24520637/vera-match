import { BadRequestException } from "@nestjs/common";

export interface ApproveExpertInput {
  expectedRevision: number;
  trainingVersion: string;
  policyVersion: string;
  trainingEvidenceId: string;
  confidentialityEvidenceId: string;
  expiresAt: Date | null;
}
export function approvalInvalid(field: string, message: string): never {
  throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Check the submitted fields.",
    details: [{ field, messages: [message] }] });
}
const identifiers = ["trainingVersion", "policyVersion", "trainingEvidenceId", "confidentialityEvidenceId"] as const;
export function parseExpertApproval(value: unknown): ApproveExpertInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) approvalInvalid("_form", "Send an approval object.");
  const body = value as Record<string, unknown>;
  const allowed = ["expectedRevision", "expiresAt", ...identifiers];
  if (Object.keys(body).some(key => !allowed.includes(key))) approvalInvalid("_form", "Remove unsupported fields.");
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0)
    approvalInvalid("expectedRevision", "A nonnegative safe integer revision is required.");
  for (const field of identifiers) {
    if (typeof body[field] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(body[field] as string))
      approvalInvalid(field, "Use an opaque identifier of 1 to 200 ASCII characters.");
  }
  let expiresAt: Date | null = null;
  if (body.expiresAt !== null) {
    if (typeof body.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.expiresAt))
      approvalInvalid("expiresAt", "Send null or an ISO UTC timestamp with milliseconds.");
    expiresAt = new Date(body.expiresAt as string);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== body.expiresAt)
      approvalInvalid("expiresAt", "Use a valid UTC timestamp.");
  }
  return { expectedRevision: body.expectedRevision as number, trainingVersion: body.trainingVersion as string,
    policyVersion: body.policyVersion as string, trainingEvidenceId: body.trainingEvidenceId as string,
    confidentialityEvidenceId: body.confidentialityEvidenceId as string, expiresAt };
}
