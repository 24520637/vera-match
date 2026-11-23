import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function encodeTotpSecret(bytes: Buffer): string {
  if (bytes.length !== 20) throw new Error("MFA_SECRET_INVALID");
  let bits = 0, value = 0, encoded = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; encoded += alphabet[(value >>> bits) & 31]; }
    value &= (1 << bits) - 1;
  }
  return encoded;
}
export function decodeTotpSecret(encoded: string): Buffer {
  if (!/^[A-Z2-7]{32}$/.test(encoded)) throw new Error("MFA_SECRET_INVALID");
  let bits = 0, value = 0; const decoded: number[] = [];
  for (const character of encoded) {
    value = (value << 5) | alphabet.indexOf(character); bits += 5;
    if (bits >= 8) { bits -= 8; decoded.push((value >>> bits) & 255); }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(decoded);
}
/** RFC 4226 primitive; production TOTP fixes SHA-1, six digits and a 30s step. */
export function hotp(secret: Buffer, counter: bigint, digits: 6 | 8 = 6): string {
  if (secret.length < 20 || secret.length > 64 || counter < 0n || counter > 0xffffffffffffffffn || ![6, 8].includes(digits)) throw new Error("MFA_COUNTER_INVALID");
  const input = Buffer.alloc(8); input.writeBigUInt64BE(counter);
  const mac = createHmac("sha1", secret).update(input).digest();
  const offset = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).toString().padStart(digits, "0");
}
/** Returns a counter for a transactionally locked lastCounter CAS, never assurance.
 * Callers must consume this counter in the same transaction as the MFA/session proof. */
export function matchingTotpCounter(secret: Buffer, code: string, nowMs: number, lastCounter: bigint): bigint | undefined {
  if (!/^[0-9]{6}$/.test(code) || !Number.isSafeInteger(nowMs) || nowMs < 30000 || lastCounter < -1n) return undefined;
  const current = BigInt(Math.floor(nowMs / 30000)); let matched: bigint | undefined;
  for (const shift of [-1n, 0n, 1n]) {
    const candidate = current + shift;
    const equal = timingSafeEqual(Buffer.from(hotp(secret, candidate)), Buffer.from(code));
    if (equal && candidate > lastCounter) matched = candidate;
  }
  return matched;
}
export function newTotpSecret(): Buffer { return randomBytes(20); }

/** Separate wrapping keys are provisioned outside the database and repository. */
export class MfaSecretBox {
  constructor(private readonly keys: ReadonlyMap<string, Buffer>, private readonly activeKeyId: string) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(activeKeyId) || !keys.has(activeKeyId) || keys.size > 8 || keys.size < 1 || [...keys].some(([id, key]) => !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || key.length !== 32)) throw new Error("MFA_KEYRING_INVALID");
    this.keys = new Map([...keys].map(([id, key]) => [id, Buffer.from(key)]));
  }
  seal(secret: Buffer, binding: string): string {
    if (secret.length !== 20 || !binding || binding.length > 512) throw new Error("MFA_SECRET_INVALID");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.activeKeyId)!, nonce);
    cipher.setAAD(Buffer.from("VERA-MATCH:MFA:v1:" + JSON.stringify([this.activeKeyId, binding])));
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    return ["v1", this.activeKeyId, nonce.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }
  open(envelope: string, binding: string): Buffer {
    try {
      if (typeof envelope !== "string" || envelope.length > 256 || !binding || binding.length > 512) throw new Error();
      const parts = envelope.split(".");
      if (parts.length !== 5 || parts[0] !== "v1") throw new Error();
      const key = this.keys.get(parts[1]); if (!key) throw new Error();
      const chunks = parts.slice(2).map(part => { const value = Buffer.from(part, "base64url"); if (value.toString("base64url") !== part) throw new Error(); return value; });
      if (chunks[0].length !== 12 || chunks[1].length !== 20 || chunks[2].length !== 16) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", key, chunks[0]);
      decipher.setAAD(Buffer.from("VERA-MATCH:MFA:v1:" + JSON.stringify([parts[1], binding]))); decipher.setAuthTag(chunks[2]);
      return Buffer.concat([decipher.update(chunks[1]), decipher.final()]);
    } catch { throw new Error("MFA_SECRET_UNAVAILABLE"); }
  }
  rewrap(envelope: string, binding: string): string {
    const secret = this.open(envelope, binding);
    try { return this.seal(secret, binding); } finally { secret.fill(0); }
  }
}
export function recoveryCodeHash(code: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return undefined;
  const value = Buffer.from(code, "base64url");
  if (value.length !== 32 || value.toString("base64url") !== code) return undefined;
  return createHash("sha256").update("VERA-MATCH:MFA-RECOVERY:v1:").update(value).digest("hex");
}
export function newRecoveryCodes() {
  return Array.from({ length: 8 }, () => { const code = randomBytes(32).toString("base64url"); return { code, hash: recoveryCodeHash(code)! }; });
}
