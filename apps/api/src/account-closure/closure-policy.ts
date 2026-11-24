import { Injectable } from "@nestjs/common";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

export const minimizationActions = ["ERASE_MUTABLE_MEMBER_DATA", "ERASE_UNSUBMITTED_REVIEW_CONTENT", "RESTRICT_RETAINED_EVIDENCE"] as const;
export interface ClosureMinimizationPolicy {
  schemaVersion: 1; purpose: "CLOSURE_MINIMIZATION"; version: string;
  approvedByReference: string; legalBasisReference: string; approvedAt: string; expiresAt: string;
  actions: typeof minimizationActions;
  retainedEvidence: "RESTRICTED_PENDING_APPROVED_RETENTION";
  finalErasureClaim: false;
}
const fields = ["schemaVersion", "purpose", "version", "approvedByReference", "legalBasisReference", "approvedAt", "expiresAt", "actions", "retainedEvidence", "finalErasureClaim"].sort();
export function closurePolicyMessage(payload: ClosureMinimizationPolicy) {
  return Buffer.from("VERA:CLOSURE-MINIMIZATION:v1\n{" + fields.map(key => JSON.stringify(key) + ":" + JSON.stringify(payload[key as keyof ClosureMinimizationPolicy])).join(",") + "}");
}
export function verifyClosurePolicy(serialized: string, publicKey: string, now = new Date()) {
  const invalid = (): never => { throw new Error("CLOSURE_POLICY_INVALID"); };
  try {
    if (Buffer.byteLength(serialized) > 16384 || Buffer.byteLength(publicKey) > 16384 || publicKey.includes("PRIVATE KEY")) return invalid();
    const envelope = JSON.parse(serialized), p = envelope?.payload as ClosureMinimizationPolicy;
    if (!envelope || Object.keys(envelope).sort().join(",") !== "payload,signature" || !p || Object.keys(p).sort().join(",") !== fields.join(",") ||
        p.schemaVersion !== 1 || p.purpose !== "CLOSURE_MINIMIZATION" || p.finalErasureClaim !== false ||
        p.retainedEvidence !== "RESTRICTED_PENDING_APPROVED_RETENTION" || JSON.stringify(p.actions) !== JSON.stringify(minimizationActions)) return invalid();
    for (const value of [p.version, p.approvedByReference, p.legalBasisReference])
      if (typeof value !== "string" || !/^[A-Za-z0-9_.:/-]{1,200}$/.test(value) || /draft|review_required|replace|placeholder/i.test(value)) return invalid();
    const at = new Date(p.approvedAt), expiry = new Date(p.expiresAt);
    if (!Number.isFinite(now.getTime()) || !Number.isFinite(at.getTime()) || !Number.isFinite(expiry.getTime()) ||
        at.toISOString() !== p.approvedAt || expiry.toISOString() !== p.expiresAt || at > now || expiry <= now || expiry <= at || expiry.getTime() - at.getTime() > 90 * 86400000) return invalid();
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== "ed25519" || typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature) ||
        !verify(null, closurePolicyMessage(p), key, Buffer.from(envelope.signature, "base64url"))) return invalid();
    return { payload: p, envelope, digest: createHash("sha256").update(closurePolicyMessage(p)).digest("hex") };
  } catch { return invalid(); }
}
@Injectable()
export class ClosurePolicyRegistry {
  current() {
    const manifest = process.env.CLOSURE_POLICY_MANIFEST_PATH, key = process.env.CLOSURE_POLICY_APPROVAL_PUBLIC_KEY_PATH;
    if (!manifest && !key) return undefined;
    if (!manifest || !key || !isAbsolute(manifest) || !isAbsolute(key) || statSync(manifest).size > 16384 || statSync(key).size > 16384)
      throw new Error("CLOSURE_POLICY_CONFIGURATION_INVALID");
    return verifyClosurePolicy(readFileSync(manifest, "utf8"), readFileSync(key, "utf8"));
  }
}
