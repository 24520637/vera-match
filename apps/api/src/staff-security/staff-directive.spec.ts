import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { StaffDirectiveVerifier, staffDirectiveMessage, staffEmailDigest, type StaffDirective } from "./staff-directive";

describe("Trusted staff directives", () => {
  const authority = generateKeyPairSync("ed25519"), other = generateKeyPairSync("ed25519");
  const publicPem = authority.publicKey.export({type:"spki",format:"pem"}).toString();
  const now = new Date("2026-11-24T00:00:00.000Z");
  const payload = (): StaffDirective => ({schemaVersion:1,directiveId:randomUUID(),authorityKeyId:"root-1",subjectId:randomUUID(),userId:"synthetic-staff",emailDigest:staffEmailDigest("staff@example.invalid"),role:"MODERATOR",state:"ACTIVE",revision:1,mfaEpoch:1,permissions:[],issuedAt:"2026-11-23T00:00:00.000Z",expiresAt:"2026-12-23T00:00:00.000Z"});
  const envelope = (p: StaffDirective, privateKey = authority.privateKey) => JSON.stringify({payload:p,signature:sign(null,staffDirectiveMessage(p),privateKey).toString("base64url")});
  const verifier = () => new StaffDirectiveVerifier(new Map([["root-1",publicPem]]));
  it("verifies an exact signed instruction and freezes the result", () => {
    const p = payload(), result = verifier().verify(envelope(p),now);
    expect(result).toEqual(p); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.permissions)).toBe(true);
    expect(staffEmailDigest(" STAFF@EXAMPLE.INVALID ")).toBe(p.emailDigest);
  });
  it("does not accept a self-signed role claim or another authority", () => {
    expect(() => verifier().verify(envelope(payload(),other.privateKey),now)).toThrow("STAFF_DIRECTIVE_INVALID");
    const p = payload(), wire = JSON.parse(envelope(p)); wire.payload.role = "ADMIN";
    expect(() => verifier().verify(JSON.stringify(wire),now)).toThrow("STAFF_DIRECTIVE_INVALID");
  });
  it("binds the signature to this operation, not another signed capability", () => {
    const p = payload(); const wrong = sign(null,Buffer.from("VERA-MATCH:CONSENT-POLICY-APPROVAL:v1\n"+JSON.stringify(p)),authority.privateKey).toString("base64url");
    expect(() => verifier().verify(JSON.stringify({payload:p,signature:wrong}),now)).toThrow("STAFF_DIRECTIVE_INVALID");
  });
  it.each([
    {role:"MEMBER"},{revision:0},{revision:Number.MAX_SAFE_INTEGER+1},{mfaEpoch:0},
    {issuedAt:"2026-11-25T00:00:00.000Z"},{expiresAt:"2026-11-24T00:00:00.000Z"},
    {expiresAt:"2027-11-24T00:00:00.000Z"},{issuedAt:"2026-11-23"},
    {permissions:["ASSIGNMENT_GRANT_ADMIN"]},{permissions:["ALL"]},
    {subjectId:"other"},{emailDigest:"staff@example.invalid"},{authorityKeyId:"unknown"},
  ])("rejects a signed but invalid instruction %j", patch => {
    const p = {...payload(),...patch} as StaffDirective;
    expect(() => verifier().verify(envelope(p),now)).toThrow("STAFF_DIRECTIVE_INVALID");
  });
  it("requires explicit ADMIN permission and rejects privileges on revocation", () => {
    const p = {...payload(),role:"ADMIN",permissions:["ASSIGNMENT_GRANT_ADMIN"]} as StaffDirective;
    expect(verifier().verify(envelope(p),now).permissions).toEqual(["ASSIGNMENT_GRANT_ADMIN"]);
    p.state = "REVOKED"; expect(() => verifier().verify(envelope(p),now)).toThrow("STAFF_DIRECTIVE_INVALID");
    p.permissions = []; expect(verifier().verify(envelope(p),now).state).toBe("REVOKED");
  });
  it("rejects extra fields, private keys, oversized input and malformed signatures", () => {
    const p = payload(); const extra = {...p,enableMfa:true} as StaffDirective;
    expect(() => verifier().verify(envelope(extra),now)).toThrow("STAFF_DIRECTIVE_INVALID");
    for (const value of ["null","[]","x".repeat(9000),JSON.stringify({payload:p,signature:"x"}),JSON.stringify({...JSON.parse(envelope(p)),extra:true})]) expect(() => verifier().verify(value,now)).toThrow("STAFF_DIRECTIVE_INVALID");
    const privatePem = authority.privateKey.export({type:"pkcs8",format:"pem"}).toString();
    expect(() => new StaffDirectiveVerifier(new Map([["root-1",privatePem]]))).toThrow("STAFF_DIRECTIVE_INVALID");
    expect(() => new StaffDirectiveVerifier(new Map())).toThrow("STAFF_DIRECTIVE_INVALID");
  });
  it("supports reviewed authority rotation without silently trusting retired roots", () => {
    const p = payload(); const oldWire = envelope(p);
    const rotated = new StaffDirectiveVerifier(new Map([["root-1",publicPem],["root-2",other.publicKey.export({type:"spki",format:"pem"}).toString()]]));
    expect(rotated.verify(oldWire,now)).toEqual(p);
    p.authorityKeyId = "root-2"; const next = envelope(p,other.privateKey); expect(rotated.verify(next,now)).toEqual(p);
    const retired = new StaffDirectiveVerifier(new Map([["root-2",other.publicKey.export({type:"spki",format:"pem"}).toString()]]));
    expect(() => retired.verify(oldWire,now)).toThrow("STAFF_DIRECTIVE_INVALID");
  });
});
