import { createPublicKey, verify } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { canonicalPolicyPayload } from "../consent/consent-policy.publication";

export interface QualificationPublication {
  schemaVersion: 1;
  publicationId: string;
  issuedAt: string;
  expiresAt: string;
  versions: { kind: "TRAINING_COMPLETION" | "CONFIDENTIALITY_ACCEPTANCE"; version: string; content: string }[];
  evidence: { id: string; userId: string; kind: "TRAINING_COMPLETION" | "CONFIDENTIALITY_ACCEPTANCE"; version: string; content: string; recordedAt: string; validUntil: string }[];
}
export const qualificationMessage = (payload: unknown) => Buffer.from("VERA-MATCH:EXPERT-QUALIFICATION:v1\n" + canonicalPolicyPayload(payload));
const fail = (): never => { throw new Error("EXPERT_QUALIFICATION_INVALID"); };
const exact = (x: unknown, keys: string[]): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join() === [...keys].sort().join();
const text = (x: unknown, max: number) => typeof x === "string" && x.trim().length > 0 && Buffer.byteLength(x) <= max;
const id = (x: unknown) => typeof x === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(x);
const date = (x: unknown): number => { if (typeof x !== "string") return fail(); const n = Date.parse(x); if (!Number.isFinite(n) || new Date(n).toISOString() !== x) return fail(); return n; };
export function verifyQualification(serialized: string, pem: string, now = Date.now()): QualificationPublication {
  try {
    if (Buffer.byteLength(serialized) > 1048576 || Buffer.byteLength(pem) > 16384 || pem.includes("PRIVATE KEY")) return fail();
    const envelope: unknown = JSON.parse(serialized);
    if (!exact(envelope, ["payload", "signature"]) || typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) return fail();
    const key = createPublicKey(pem), signature = Buffer.from(envelope.signature, "base64url");
    if (key.asymmetricKeyType !== "ed25519" || signature.toString("base64url") !== envelope.signature || !verify(null, qualificationMessage(envelope.payload), key, signature)) return fail();
    const p = envelope.payload;
    if (!exact(p, ["schemaVersion", "publicationId", "issuedAt", "expiresAt", "versions", "evidence"]) || p.schemaVersion !== 1 || !id(p.publicationId)) return fail();
    const issued = date(p.issuedAt), expires = date(p.expiresAt);
    if (issued > now || expires <= now || expires <= issued || expires - issued > 86400000 || !Array.isArray(p.versions) || !Array.isArray(p.evidence) || p.versions.length > 100 || p.evidence.length > 1000) return fail();
    const versions = new Set<string>(), evidence = new Set<string>();
    for (const v of p.versions) {
      if (!exact(v, ["kind", "version", "content"]) || !["TRAINING_COMPLETION", "CONFIDENTIALITY_ACCEPTANCE"].includes(v.kind as string) || !id(v.version) || !text(v.content, 65536)) return fail();
      const key = v.kind + ":" + v.version; if (versions.has(key)) return fail(); versions.add(key);
    }
    for (const e of p.evidence) {
      if (!exact(e, ["id", "userId", "kind", "version", "content", "recordedAt", "validUntil"]) || !id(e.id) || !id(e.userId) || !versions.has(e.kind + ":" + e.version) || !text(e.content, 65536) || evidence.has(e.id as string)) return fail();
      const recorded = date(e.recordedAt), until = date(e.validUntil);
      if (recorded > issued || until <= recorded) return fail(); evidence.add(e.id as string);
    }
    return p as unknown as QualificationPublication;
  } catch { return fail(); }
}
/** Read the operator-owned file per lookup so removal/revocation never needs a process restart.
 * Install by atomic rename; malformed/expired/partial files deny, never retain stale success.
 */
export function currentQualification(): QualificationPublication | undefined {
  const manifest = process.env.EXPERT_QUALIFICATION_MANIFEST_PATH, key = process.env.EXPERT_QUALIFICATION_PUBLIC_KEY_PATH;
  if (!manifest && !key) return undefined;
  if (!manifest || !key || !isAbsolute(manifest) || !isAbsolute(key)) return fail();
  if (!statSync(manifest).isFile() || statSync(manifest).size > 1048576 || !statSync(key).isFile() || statSync(key).size > 16384) return fail();
  return verifyQualification(readFileSync(manifest, "utf8"), readFileSync(key, "utf8"));
}
