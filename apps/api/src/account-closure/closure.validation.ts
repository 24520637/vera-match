import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const invalid = (): never => { throw new BadRequestException({ code: "INVALID_REQUEST", message: "Check the closure form.",
  details: [{ field: "_form", messages: ["Enter your current password and CLOSE MY ACCOUNT."] }] }); };
export function closureInput(input: unknown, key: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some(k => !["confirmation", "password", "expectedRevision"].includes(k)) ||
      row.confirmation !== "CLOSE MY ACCOUNT" || row.expectedRevision !== 0 ||
      typeof row.password !== "string" || !row.password.length || Buffer.byteLength(row.password) > 1024 ||
      typeof key !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)) return invalid();
  // Do not retain a password-derived fingerprint, even a fast hash of one.
  return { password: row.password, keyHash: digest(key.toLowerCase()),
    fingerprint: digest(JSON.stringify({ confirmation: row.confirmation, expectedRevision: 0 })) };
}
export function tokenInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const row = input as Record<string, unknown>;
  return Object.keys(row).length === 1 && typeof row.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(row.token) &&
    Buffer.from(row.token, "base64url").toString("base64url") === row.token ? row.token : "";
}
