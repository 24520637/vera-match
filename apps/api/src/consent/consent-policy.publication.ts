import { createHash, createPublicKey, verify } from "node:crypto";
import { ConsentPurpose } from "@prisma/client";
import { candidateNotices, candidatePolicyVersion } from "./consent-policy.catalog";
import type { PolicySnapshot } from "./consent.policy";

export type PolicyLocale = "en" | "vi";
export interface PolicyApprovalPayload {
  schemaVersion: 1;
  publicationId: string;
  approvedByReference: string;
  legalBasisReference: string;
  approvedAt: string;
  expiresAt: string;
  policies: { purpose: ConsentPurpose; policyVersion: string; locale: PolicyLocale; content: string; digest: string }[];
}
export function canonicalPolicyPayload(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalPolicyPayload).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalPolicyPayload((value as Record<string, unknown>)[key])).join(",") + "}";
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("CONSENT_POLICY_APPROVAL_INVALID");
  return serialized;
}
export const policyApprovalMessage = (payload: unknown) => Buffer.from("VERA-MATCH:CONSENT-POLICY-APPROVAL:v1\n" + canonicalPolicyPayload(payload), "utf8");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const digest = (s: string) => createHash("sha256").update(s,"utf8").digest("hex");
const invalid = (): never => { throw new Error("CONSENT_POLICY_APPROVAL_INVALID"); };

/** Signature verification proves only the configured authority signed exact content.
 * The operator must establish that key authority and obtain real content/legal approval.
 * This function never creates approval or a signing key. */
export function verifyPolicyPublication(serialized: string, publicKeyPem: string, now = new Date()) {
  try {
    if (Buffer.byteLength(serialized) > 262144 || Buffer.byteLength(publicKeyPem) > 16384 || publicKeyPem.includes("PRIVATE KEY")) return invalid();
    const envelope: unknown = JSON.parse(serialized);
    if (!object(envelope) || !exact(envelope, ["payload", "signature"]) || !object(envelope.payload) || typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) return invalid();
    const key = createPublicKey(publicKeyPem);
    const signature = Buffer.from(envelope.signature, "base64url");
    if (key.asymmetricKeyType !== "ed25519" || signature.length !== 64 || signature.toString("base64url") !== envelope.signature || !verify(null, policyApprovalMessage(envelope.payload), key, signature)) return invalid();
    const payload = envelope.payload;
    if (!exact(payload, ["schemaVersion", "publicationId", "approvedByReference", "legalBasisReference", "approvedAt", "expiresAt", "policies"]) || payload.schemaVersion !== 1) return invalid();
    for (const k of ["publicationId", "approvedByReference", "legalBasisReference"]) if (typeof payload[k] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(payload[k] as string)) return invalid();
    if (typeof payload.approvedAt !== "string" || typeof payload.expiresAt !== "string") return invalid();
    const approved = new Date(payload.approvedAt), expires = new Date(payload.expiresAt);
    if (!Number.isFinite(approved.getTime()) || !Number.isFinite(expires.getTime()) || approved.toISOString() !== payload.approvedAt || expires.toISOString() !== payload.expiresAt || approved > now || expires <= now || expires <= approved || expires.getTime() - approved.getTime() > 366 * 86400000) return invalid();
    if (!Array.isArray(payload.policies) || !payload.policies.length || payload.policies.length > 10) return invalid();
    const snapshots: PolicySnapshot[] = [], seen = new Set<string>();
    for (const entry of payload.policies) {
      if (!object(entry) || !exact(entry, ["purpose", "policyVersion", "locale", "content", "digest"]) || !Object.values(ConsentPurpose).includes(entry.purpose as ConsentPurpose) || !["en","vi"].includes(entry.locale as string)) return invalid();
      const purpose = entry.purpose as ConsentPurpose, locale = entry.locale as PolicyLocale, identity = purpose + ":" + locale;
      if (seen.has(identity) || entry.policyVersion !== candidatePolicyVersion || entry.content !== candidateNotices[purpose][locale] || entry.digest !== digest(entry.content as string)) return invalid();
      seen.add(identity);
      snapshots.push(Object.freeze({ purpose, locale, policyVersion: entry.policyVersion, content: entry.content as string, testOnly: false }));
    }
    for (const purpose of new Set(snapshots.map(p => p.purpose))) if (!seen.has(purpose + ":en") || !seen.has(purpose + ":vi")) return invalid();
    return Object.freeze({ publicationId: payload.publicationId as string, expiresAt: expires.getTime(), snapshots: Object.freeze(snapshots) });
  } catch { return invalid(); }
}
