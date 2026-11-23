import { generateKeyPairSync, sign } from "node:crypto";
import { qualificationMessage, verifyQualification, QualificationPublication } from "./expert-qualification.publication";
const root = generateKeyPairSync("ed25519"), pem = root.publicKey.export({type:"spki",format:"pem"}).toString();
const now = Date.now();
const payload = (): QualificationPublication => ({schemaVersion:1,publicationId:"synthetic-test",issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),versions:[{kind:"TRAINING_COMPLETION",version:"v1",content:"Synthetic training curriculum"}],evidence:[{id:"completion",userId:"expert",kind:"TRAINING_COMPLETION",version:"v1",content:"Synthetic completion evidence",recordedAt:new Date(now-2000).toISOString(),validUntil:new Date(now+60000).toISOString()}]});
const wire = (p:QualificationPublication) => JSON.stringify({payload:p,signature:sign(null,qualificationMessage(p),root.privateKey).toString("base64url")});
describe("trusted expert qualification publication",()=>{
 it("verifies exact signed versions and target-bound evidence",()=>{const p=payload();expect(verifyQualification(wire(p),pem,now)).toEqual(p);});
 it("rejects tampering and wrong authority",()=>{expect(()=>verifyQualification(wire(payload()).replace('"expert"','"other"'),pem,now)).toThrow();const other=generateKeyPairSync("ed25519").publicKey.export({type:"spki",format:"pem"}).toString();expect(()=>verifyQualification(wire(payload()),other,now)).toThrow();});
 it.each(["expired","future","duplicate","missingVersion","futureEvidence","extraField"])("rejects %s publication",mode=>{const p=payload();if(mode==="expired")p.expiresAt=new Date(now-1).toISOString();if(mode==="future")p.issuedAt=new Date(now+1).toISOString();if(mode==="duplicate")p.evidence.push(p.evidence[0]);if(mode==="missingVersion")p.versions=[];if(mode==="futureEvidence")p.evidence[0].recordedAt=new Date(now+1000).toISOString();if(mode==="extraField")(p as unknown as Record<string,unknown>).approved=true;expect(()=>verifyQualification(wire(p),pem,now)).toThrow();});
 it("cannot reuse a staff or consent signature domain",()=>{const p=payload();const signature=sign(null,Buffer.from(JSON.stringify(p)),root.privateKey).toString("base64url");expect(()=>verifyQualification(JSON.stringify({payload:p,signature}),pem,now)).toThrow();});
});
