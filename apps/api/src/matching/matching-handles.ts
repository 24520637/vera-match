import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { AuthContext } from "../auth/auth-context";
import { EnvironmentService } from "../config/environment.service";

const encoding = /^[A-Za-z0-9_-]+$/;
type Purpose = "decision" | "recommendations" | "history";
export type ConsentStamp = { subjectId: string; version: bigint };
type ReferenceStamp = { subjectId: string; version: string; blocks: number };
type Payload = { id: string; expires: number; createdAt?: string; authorization?: [ReferenceStamp, ReferenceStamp] };

function isStamp(value: unknown): value is ReferenceStamp {
  if (!value || typeof value !== "object") return false;
  const { subjectId, version, blocks } = value as ReferenceStamp;
  return typeof subjectId === "string" && typeof version === "string" && /^\d{1,16}$/.test(version) &&
    Number.isSafeInteger(blocks) && blocks >= 0;
}

@Injectable()
export class MatchingHandles {
  private readonly key: Buffer | undefined;

  constructor(environment: EnvironmentService) {
    const value = process.env.MATCHING_HANDLE_KEY;
    if (value && /^[a-f0-9]{64}$/i.test(value)) this.key = Buffer.from(value, "hex");
    else if (value === undefined && environment.values.nodeEnv !== "production") this.key = randomBytes(32);
  }

  requireKey() {
    if (!this.key) throw new ServiceUnavailableException({
      code: "MATCHING_UNAVAILABLE", message: "Matching is temporarily unavailable.",
    });
    return this.key;
  }

  issue(auth: AuthContext, purpose: Purpose, payload: Payload) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.requireKey(), iv);
    cipher.setAAD(this.context(auth, purpose));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  }

  read(auth: AuthContext, purpose: Purpose, input: string): Payload | null {
    const key = this.requireKey();
    if (input.length > 768 || !encoding.test(input)) return null;
    try {
      const buffer = Buffer.from(input, "base64url");
      if (buffer.length <= 28 || buffer.toString("base64url") !== input) return null;
      const cipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      cipher.setAAD(this.context(auth, purpose));
      cipher.setAuthTag(buffer.subarray(12, 28));
      const data: Payload = JSON.parse(Buffer.concat([
        cipher.update(buffer.subarray(28)), cipher.final(),
      ]).toString("utf8"));
      if (typeof data.id !== "string" || !data.id || !Number.isSafeInteger(data.expires) ||
        (data.createdAt !== undefined && (typeof data.createdAt !== "string" || !Number.isFinite(Date.parse(data.createdAt)))) ||
        (data.authorization !== undefined && (!Array.isArray(data.authorization) || data.authorization.length !== 2 ||
          !data.authorization.every(isStamp)))) return null;
      return data;
    } catch {
      return null;
    }
  }

  keyFor(auth: AuthContext, scope: "recommendation" | "history", id: string) {
    return createHmac("sha256", this.requireKey()).update(JSON.stringify([scope, auth.user.id, id]))
      .digest("hex");
  }

  private context(auth: AuthContext, purpose: Purpose) {
    return Buffer.from(JSON.stringify(["vera-matching-v1", purpose, auth.user.id, auth.sessionId]));
  }
}
