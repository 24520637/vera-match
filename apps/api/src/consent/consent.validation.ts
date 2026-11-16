import { createHash } from "node:crypto";
import { ConsentPurpose } from "@prisma/client";
import { invalidRequest } from "../profile/profile.validation";
import { consentPurposes } from "./consent.policy";

export interface ConsentPatchDto {
  expectedVersion: number;
  consents: { purpose: ConsentPurpose; granted: boolean; policyVersion?: string }[];
}
export interface ConsentReadDto {
  version: number;
  consents: { purpose: ConsentPurpose; granted: boolean; grantedAt: string | null;
    revokedAt: string | null; policyVersion: string | null; updatedAt: string | null }[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function parseConsentPatch(input: unknown): ConsentPatchDto {
  if (!object(input)) return invalidRequest([{ field: "_form", messages: ["Send a consent object."] }]);
  const errors: { field: string; messages: string[] }[] = [];
  if (Object.keys(input).some(key => !["expectedVersion", "consents"].includes(key))) errors.push({ field: "_form", messages: ["Remove unsupported fields."] });
  if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) errors.push({ field: "expectedVersion", messages: ["A nonnegative safe integer version is required."] });
  if (!Array.isArray(input.consents) || !input.consents.length || input.consents.length > 5) {
    errors.push({ field: "consents", messages: ["Submit one to five distinct purposes."] });
    return invalidRequest(errors);
  }
  const seen = new Set<string>();
  input.consents.forEach((item: unknown, index: number) => {
    const path = `consents.${index}`;
    if (!object(item)) { errors.push({ field: path, messages: ["Send a consent object."] }); return; }
    if (Object.keys(item).some(key => !["purpose", "granted", "policyVersion"].includes(key))) errors.push({ field: path, messages: ["Remove unsupported fields."] });
    if (typeof item.purpose !== "string" || !consentPurposes.includes(item.purpose as ConsentPurpose) || seen.has(item.purpose)) errors.push({ field: `${path}.purpose`, messages: ["Choose each supported purpose at most once."] });
    if (typeof item.purpose === "string") seen.add(item.purpose);
    if (typeof item.granted !== "boolean") errors.push({ field: `${path}.granted`, messages: ["Use a literal boolean."] });
    if (Object.prototype.hasOwnProperty.call(item, "policyVersion") && typeof item.policyVersion !== "string") errors.push({ field: `${path}.policyVersion`, messages: ["Use a policy identifier string."] });
  });
  if (errors.length) return invalidRequest(errors);
  const consents = input.consents as ConsentPatchDto["consents"];
  if (consents.some(item => item.granted) && consents.some(item => !item.granted)) {
    return invalidRequest([{ field: "_form", messages: ["Submit withdrawals separately from grants."] }]);
  }
  return { expectedVersion: input.expectedVersion as number, consents };
}
export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) return invalidRequest([
    { field: "_form", messages: ["Send a random Idempotency-Key of 16-128 ASCII letters, digits, hyphens or underscores."] },
  ]);
  return createHash("sha256").update(value).digest("hex");
}
export function consentFingerprint(dto: ConsentPatchDto): string {
  const consents = [...dto.consents].sort((a, b) => consentPurposes.indexOf(a.purpose) - consentPurposes.indexOf(b.purpose))
    .map(item => ({ purpose: item.purpose, granted: item.granted, policyVersion: item.policyVersion ?? null }));
  return createHash("sha256").update(JSON.stringify({ expectedVersion: dto.expectedVersion, consents })).digest("hex");
}
