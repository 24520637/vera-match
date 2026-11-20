import { identifier, invalid, object } from "../safety/safety.validation";

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= Number.MAX_SAFE_INTEGER)
    invalid("expectedRevision", "Use a nonnegative safe revision that can advance.");
  return value as number;
}
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))
    invalid(field, "Use a valid scope or grant reference.");
  return (value as string).toLowerCase();
}
/** Internal service inputs only; no external route or DTO contract is published. */
export function grantInput(value: unknown) {
  const body = object(value, ["assignmentId", "moderatorId", "expectedRevision", "expiresAt"]);
  const assignmentId = identifier(body.assignmentId, "assignmentId"), moderatorId = identifier(body.moderatorId, "moderatorId");
  if (typeof body.expiresAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(body.expiresAt) ||
    !Number.isFinite(Date.parse(body.expiresAt)) || new Date(body.expiresAt).toISOString() !== body.expiresAt)
    invalid("expiresAt", "Send a required UTC timestamp with milliseconds.");
  return { assignmentId, moderatorId, expectedRevision: revision(body.expectedRevision), expiresAt: new Date(body.expiresAt as string) };
}
export function revokeInput(value: unknown) {
  const body = object(value, ["scopeId", "grantId", "expectedRevision"]);
  return { scopeId: uuid(body.scopeId, "scopeId"), grantId: uuid(body.grantId, "grantId"), expectedRevision: revision(body.expectedRevision) };
}
