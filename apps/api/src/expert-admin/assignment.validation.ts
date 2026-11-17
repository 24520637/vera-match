import { createHash } from "node:crypto";
import { approvalInvalid } from "./expert-approval.validation";

export interface AssignmentInput {
  videoId: string;
  expertId: string;
  expectedCredentialRevision: number;
  dueAt: Date | null;
  expiresAt: Date | null;
}
function date(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    approvalInvalid(field, "Send null or a UTC timestamp with milliseconds.");
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) approvalInvalid(field, "Send a valid UTC timestamp.");
  return parsed;
}
export function parseAssignment(input: unknown): AssignmentInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) approvalInvalid("_form", "Send an assignment object.");
  const body = input as Record<string, unknown>;
  const keys = ["videoId", "expertId", "expectedCredentialRevision", "dueAt", "expiresAt"];
  if (Object.keys(body).some(key => !keys.includes(key))) approvalInvalid("_form", "Remove unsupported fields.");
  for (const field of ["videoId", "expertId"]) {
    if (typeof body[field] !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(body[field] as string)) approvalInvalid(field, "Send a valid identifier.");
  }
  if (!Number.isSafeInteger(body.expectedCredentialRevision) || (body.expectedCredentialRevision as number) < 0)
    approvalInvalid("expectedCredentialRevision", "Send a nonnegative safe integer revision.");
  const dueAt = date(body, "dueAt"), expiresAt = date(body, "expiresAt");
  if (dueAt && expiresAt && dueAt > expiresAt) approvalInvalid("dueAt", "The deadline must not exceed access expiry.");
  return { videoId: body.videoId as string, expertId: body.expertId as string,
    expectedCredentialRevision: body.expectedCredentialRevision as number, dueAt, expiresAt };
}
export const assignmentFingerprint = (input: AssignmentInput) => createHash("sha256").update(JSON.stringify({
  videoId: input.videoId, expertId: input.expertId, expectedCredentialRevision: input.expectedCredentialRevision,
  dueAt: input.dueAt?.toISOString() ?? null, expiresAt: input.expiresAt?.toISOString() ?? null,
})).digest("hex");
