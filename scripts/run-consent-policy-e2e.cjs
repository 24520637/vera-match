const { resolve, join } = require("node:path");
const { tmpdir } = require("node:os");
const fs = require("node:fs");
const { randomUUID, generateKeyPairSync, sign, createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = resolve(__dirname, "..");
const env = { ...process.env, NODE_ENV: "test", VERA_AUTH_E2E_RUN_ID: randomUUID(), API_INTERNAL_ORIGIN: "http://localhost:4100" };
const url = new URL(env.DATABASE_URL);
if (!["localhost","127.0.0.1","[::1]"].includes(url.hostname) || url.port !== "5433") throw Error("Local disposable PostgreSQL test runtime required");
function run(file,args,cwd) {
  const r = spawnSync(process.execPath,[resolve(root,file),...args],{ cwd:resolve(root,cwd),env,stdio:"inherit",windowsHide:true });
  if (r.status !== 0) throw Error("Consent browser test command failed");
}
let directory, manifest, key;
try {
  run("node_modules/@nestjs/cli/bin/nest.js",["build"],"apps/api");
  const { candidateNotices, candidatePolicyVersion } = require(resolve(root,"apps/api/dist/consent/consent-policy.catalog.js"));
  const { policyApprovalMessage } = require(resolve(root,"apps/api/dist/consent/consent-policy.publication.js"));
  const authority = generateKeyPairSync("ed25519"), now = Date.now();
  const payload = { schemaVersion:1, publicationId:"synthetic-browser-"+randomUUID(), approvedByReference:"synthetic-test-authority", legalBasisReference:"synthetic-test-no-legal-approval", approvedAt:new Date(now-60000).toISOString(), expiresAt:new Date(now+86400000).toISOString(), policies:Object.entries(candidateNotices).flatMap(([purpose,notices])=>["en","vi"].map(locale=>({purpose,locale,policyVersion:candidatePolicyVersion,content:notices[locale],digest:createHash("sha256").update(notices[locale],"utf8").digest("hex")}))) };
  directory=fs.mkdtempSync(join(tmpdir(),"vera-policy-browser-")); manifest=join(directory,"approval.json");key=join(directory,"authority.pub");
  fs.writeFileSync(key,authority.publicKey.export({type:"spki",format:"pem"}),{mode:0o600});
  fs.writeFileSync(manifest,JSON.stringify({payload,signature:sign(null,policyApprovalMessage(payload),authority.privateKey).toString("base64url")}),{mode:0o600});
  env.CONSENT_POLICY_MANIFEST_PATH=manifest; env.CONSENT_POLICY_APPROVAL_PUBLIC_KEY_PATH=key;
  run("node_modules/next/dist/bin/next",["build"],"apps/web");
  run("node_modules/playwright/cli.js",["test","--config","playwright.policy.config.ts",...process.argv.slice(2)],"apps/web");
} catch { console.error("Consent policy browser acceptance failed; inspect the preceding synthetic test output."); process.exitCode=1; }
finally { if(manifest&&fs.existsSync(manifest))fs.unlinkSync(manifest); if(key&&fs.existsSync(key))fs.unlinkSync(key); if(directory)fs.rmdirSync(directory); }
