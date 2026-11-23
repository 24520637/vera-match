import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

export interface StaffDirective {
  schemaVersion: 1;
  directiveId: string;
  authorityKeyId: string;
  subjectId: string;
  userId: string;
  emailDigest: string;
  role: "EXPERT" | "MODERATOR" | "ADMIN";
  state: "ACTIVE" | "REVOKED";
  revision: number;
  mfaEpoch: number;
  enrollmentKeyHash: string | null;
  permissions: readonly "ASSIGNMENT_GRANT_ADMIN"[];
  issuedAt: string;
  expiresAt: string;
}
const fields = ["schemaVersion", "directiveId", "authorityKeyId", "subjectId", "userId", "emailDigest", "role", "state", "revision", "mfaEpoch", "permissions", "enrollmentKeyHash", "issuedAt", "expiresAt"].sort();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid = (): never => { throw new Error("STAFF_DIRECTIVE_INVALID"); };
/** Intentionally domain-separated from consent approvals and every other capability. */
export function staffDirectiveMessage(payload: StaffDirective): Buffer {
  return Buffer.from("VERA-MATCH:STAFF-DIRECTIVE:v1\n{" + fields.map(key => JSON.stringify(key) + ":" + JSON.stringify(payload[key as keyof StaffDirective])).join(",") + "}", "utf8");
}
export function staffEmailDigest(email: string): string {
  return createHash("sha256").update("VERA-MATCH:STAFF-EMAIL:v1:").update(email.trim().toLowerCase(), "utf8").digest("hex");
}
/** Verifies an operator's exact instruction; never creates an identity or MFA claim.
 * Persistence must bind user/email, enforce sequential revision/epoch and revoke
 * old sessions atomically. Root key custody and rollback fencing are external. */
export class StaffDirectiveVerifier {
  private readonly keys = new Map<string, KeyObject>();
  constructor(publicKeys: ReadonlyMap<string, string>) {
    try {
      if (publicKeys.size < 1 || publicKeys.size > 8) return invalid();
      for (const [id, pem] of publicKeys) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || Buffer.byteLength(pem) > 16384 || pem.includes("PRIVATE KEY")) return invalid();
        const key = createPublicKey(pem); if (key.asymmetricKeyType !== "ed25519") return invalid();
        this.keys.set(id, key);
      }
    } catch { return invalid(); }
  }
  verify(serialized: string, now: Date): Readonly<StaffDirective> {
    try {
      if (typeof serialized !== "string" || Buffer.byteLength(serialized) > 8192 || !Number.isFinite(now.getTime())) return invalid();
      const envelope = JSON.parse(serialized) as Record<string, unknown>;
      if (!envelope || Array.isArray(envelope) || Object.keys(envelope).sort().join(",") !== "payload,signature" || !envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) return invalid();
      const payload = envelope.payload as unknown as StaffDirective;
      if (Object.keys(payload).sort().join(",") !== fields.join(",") || payload.schemaVersion !== 1 || !uuid.test(payload.directiveId) || !uuid.test(payload.subjectId) || typeof payload.userId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.userId) || !/^[a-f0-9]{64}$/.test(payload.emailDigest) || !["EXPERT", "MODERATOR", "ADMIN"].includes(payload.role) || !["ACTIVE", "REVOKED"].includes(payload.state)) return invalid();
      if (!Number.isSafeInteger(payload.revision) || payload.revision < 1 || !Number.isSafeInteger(payload.mfaEpoch) || payload.mfaEpoch < 1) return invalid();
      if ((payload.state === "ACTIVE" && (typeof payload.enrollmentKeyHash !== "string" || !/^[a-f0-9]{64}$/.test(payload.enrollmentKeyHash))) || (payload.state === "REVOKED" && payload.enrollmentKeyHash !== null)) return invalid();
      if (!Array.isArray(payload.permissions) || payload.permissions.length > 1 || payload.permissions.some(p => p !== "ASSIGNMENT_GRANT_ADMIN") || (payload.permissions.length && (payload.role !== "ADMIN" || payload.state !== "ACTIVE"))) return invalid();
      if (typeof payload.issuedAt !== "string" || typeof payload.expiresAt !== "string") return invalid();
      const issued = new Date(payload.issuedAt), expiry = new Date(payload.expiresAt);
      if (!Number.isFinite(issued.getTime()) || !Number.isFinite(expiry.getTime()) || issued.toISOString() !== payload.issuedAt || expiry.toISOString() !== payload.expiresAt || issued > now || expiry <= now || expiry <= issued || expiry.getTime() - issued.getTime() > 90 * 86400000) return invalid();
      const key = this.keys.get(payload.authorityKeyId);
      if (!key || typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) return invalid();
      const signature = Buffer.from(envelope.signature, "base64url");
      if (signature.length !== 64 || signature.toString("base64url") !== envelope.signature || !verify(null, staffDirectiveMessage(payload), key, signature)) return invalid();
      return Object.freeze({ ...payload, permissions: Object.freeze([...payload.permissions]) });
    } catch { return invalid(); }
  }
}
