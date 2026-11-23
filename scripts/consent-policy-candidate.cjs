// Exports review material only. It cannot create a signature or publication approval.
const { resolve } = require("node:path");
const { createHash } = require("node:crypto");
const root=resolve(__dirname,"..");
try {
  const { candidateNotices,candidatePolicyVersion }=require(resolve(root,"apps/api/dist/consent/consent-policy.catalog.js"));
  const policies=Object.entries(candidateNotices).flatMap(([purpose,notices])=>["en","vi"].map(locale=>({purpose,policyVersion:candidatePolicyVersion,locale,content:notices[locale],digest:createHash("sha256").update(notices[locale],"utf8").digest("hex")})));
  console.log(JSON.stringify({payload:{schemaVersion:1,publicationId:null,approvedByReference:null,legalBasisReference:null,approvedAt:null,expiresAt:null,policies},signature:null},null,2));
} catch { console.error("Build the API before exporting the unsigned consent candidate."); process.exitCode=1; }
