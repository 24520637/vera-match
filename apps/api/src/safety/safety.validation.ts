import { ReportReason } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
export function invalid(field: string, message: string): never {
  throw new BadRequestException({
    code: "VALIDATION_FAILED",
    message: "Check the submitted fields.",
    details: [{ field, messages: [message] }],
  });
}
export function object(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("_form", "Send an object.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((k) => !keys.includes(k)))
    invalid("_form", "Remove unsupported fields.");
  return body;
}
export function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value))
    invalid(field, "Use a valid account or resource reference.");
  return value as string;
}
export function blockInput(value: unknown) {
  const b = object(value, ["targetUserId"]);
  return identifier(b.targetUserId, "targetUserId");
}
export function emptyInput(value: unknown) {
  object(value, []);
}
export function cursor(value: unknown): string | undefined {
  if (value === undefined) return;
  if (
    typeof value !== "string" ||
    value.length > 300 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    invalid("cursor", "Refresh the list to restart pagination.");
  const bytes = Buffer.from(value as string, "base64url"),
    id = bytes.toString("utf8");
  if (
    bytes.toString("base64url") !== value ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(id)
  )
    invalid("cursor", "Refresh the list to restart pagination.");
  return id;
}
export const nextCursor = (id: string) =>
  Buffer.from(id, "utf8").toString("base64url");

export function reportInput(value: unknown) {
  const b = object(value, ["targetUserId", "reason", "details"]),
    targetUserId = identifier(b.targetUserId, "targetUserId");
  if (
    typeof b.reason !== "string" ||
    !Object.values(ReportReason).includes(b.reason as ReportReason)
  )
    invalid("reason", "Choose a report reason.");
  if (typeof b.details !== "string")
    invalid("details", "Describe what happened in 10 to 2000 characters.");
  const details = (b.details as string)
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (
    [...details].length < 10 ||
    [...details].length > 2000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(details)
  )
    invalid("details", "Use 10 to 2000 characters without control characters.");
  if (
    /x-amz-(?:signature|credential)|(?:token|password|session)=[A-Za-z0-9_%+-]{8,}/i.test(
      details,
    )
  )
    invalid(
      "details",
      "Remove private access links and credentials from your report.",
    );
  return { targetUserId, reason: b.reason as ReportReason, details };
}
