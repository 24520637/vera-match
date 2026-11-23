import { randomBytes } from "node:crypto";
import { decodeTotpSecret, encodeTotpSecret, hotp, matchingTotpCounter, MfaSecretBox, newRecoveryCodes, newTotpSecret, recoveryCodeHash } from "./mfa-crypto";

describe("RFC-based MFA cryptography (does not itself confer assurance)", () => {
  const secret = Buffer.from("12345678901234567890", "ascii");
  it("matches all RFC 4226 HOTP test vectors", () => {
    ["755224","287082","359152","969429","338314","254676","287922","162583","399871","520489"].forEach((code,counter) => expect(hotp(secret,BigInt(counter))).toBe(code));
  });
  it.each([[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],[1234567890,"89005924"],[2000000000,"69279037"],[20000000000,"65353130"]] as const)("matches RFC 6238 SHA-1 at %s seconds", (time,code) => {
    expect(hotp(secret,BigInt(Math.floor(time / 30)),8)).toBe(code);
  });
  it("uses canonical interoperable Base32 and fresh independent secrets", () => {
    expect(encodeTotpSecret(secret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(decodeTotpSecret(encodeTotpSecret(secret))).toEqual(secret);
    expect(newTotpSecret()).not.toEqual(newTotpSecret());
    for (const invalid of ["", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ=", "a".repeat(32), "0".repeat(32)]) expect(() => decodeTotpSecret(invalid)).toThrow("MFA_SECRET_INVALID");
  });
  it("admits only one adjacent time step and rejects consumed counters", () => {
    const now = 1800000; const counter = 60n;
    for (const delta of [-1n,0n,1n]) {
      const code = hotp(secret,counter+delta);
      expect(matchingTotpCounter(secret,code,now,-1n)).toBe(counter+delta);
      expect(matchingTotpCounter(secret,code,now,counter+delta)).toBeUndefined();
    }
    for (const delta of [-2n,2n]) expect(matchingTotpCounter(secret,hotp(secret,counter+delta),now,-1n)).toBeUndefined();
    for (const code of ["12345", "1234567", " 123456", "１２３４５６", "12345x"]) expect(matchingTotpCounter(secret,code,now,-1n)).toBeUndefined();
    expect(matchingTotpCounter(secret,"123456",NaN,-1n)).toBeUndefined();
    expect(() => hotp(secret,-1n)).toThrow("MFA_COUNTER_INVALID");
  });
  it("encrypts with a fresh nonce and authenticates exact subject/device/epoch binding", () => {
    const box = new MfaSecretBox(new Map([["k1",randomBytes(32)]]),"k1");
    const binding = "subject:device:1"; const a = box.seal(secret,binding), b = box.seal(secret,binding);
    expect(a).not.toBe(b); expect(a).not.toContain(secret.toString("base64url")); expect(box.open(a,binding)).toEqual(secret);
    expect(() => box.open(a,"subject:device:2")).toThrow("MFA_SECRET_UNAVAILABLE");
    const parts = a.split("."); const tag = Buffer.from(parts[4],"base64url"); tag[0] ^= 1; parts[4] = tag.toString("base64url");
    expect(() => box.open(parts.join("."),binding)).toThrow("MFA_SECRET_UNAVAILABLE");
    expect(() => box.open(a+".extra",binding)).toThrow("MFA_SECRET_UNAVAILABLE");
  });
  it("supports explicit key rotation while denying unknown keys and key mutation", () => {
    const oldKey = randomBytes(32), newKey = randomBytes(32);
    const old = new MfaSecretBox(new Map([["old",oldKey]]),"old"); const sealed = old.seal(secret,"device");
    oldKey.fill(0); expect(old.open(sealed,"device")).toEqual(secret);
    const oldBytes = randomBytes(32); const oldBox = new MfaSecretBox(new Map([["old",oldBytes]]),"old"); const value = oldBox.seal(secret,"device");
    const rotation = new MfaSecretBox(new Map([["old",oldBytes],["new",newKey]]),"new"); const updated = rotation.rewrap(value,"device");
    expect(updated.split(".")[1]).toBe("new"); expect(rotation.open(updated,"device")).toEqual(secret);
    const retired = new MfaSecretBox(new Map([["new",newKey]]),"new");
    expect(() => retired.open(value,"device")).toThrow("MFA_SECRET_UNAVAILABLE"); expect(retired.open(updated,"device")).toEqual(secret);
    expect(() => new MfaSecretBox(new Map([["bad",Buffer.alloc(16)]]),"bad")).toThrow("MFA_KEYRING_INVALID");
  });
  it("generates high-entropy recovery codes with domain-separated hashes only", () => {
    const codes = newRecoveryCodes(); expect(codes).toHaveLength(8); expect(new Set(codes.map(x=>x.code)).size).toBe(8);
    for (const item of codes) { expect(item.code).toHaveLength(43); expect(item.hash).toMatch(/^[a-f0-9]{64}$/); expect(recoveryCodeHash(item.code)).toBe(item.hash); }
    expect(recoveryCodeHash("wrong")).toBeUndefined(); expect(recoveryCodeHash(codes[0].code+"=")).toBeUndefined();
  });
});
