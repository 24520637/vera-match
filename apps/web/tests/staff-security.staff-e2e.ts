import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { randomBytes, randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root=resolve(__dirname,"../../..");
const {StaffIdentityService}=require(resolve(root,"apps/api/dist/staff-security/staff-identity.service.js"));
const {StaffAuthority}=require(resolve(root,"apps/api/dist/staff-security/staff-authority.js"));
const {staffDirectiveMessage,staffEmailDigest}=require(resolve(root,"apps/api/dist/staff-security/staff-directive.js"));
const {staffEnrollmentKeyHash,hotp,decodeTotpSecret}=require(resolve(root,"apps/api/dist/staff-security/mfa-crypto.js"));
const argon=require("argon2");const password="Synthetic browser staff password 2026!";
async function fixture(){
 const metadata=JSON.parse(await readFile(resolve(__dirname,"../.auth-e2e-runtime.json"),"utf8"));
 if(metadata.kind!=="vera-auth-e2e-v1"||metadata.runId!==process.env.VERA_AUTH_E2E_RUN_ID||metadata.runId!==process.env.VERA_STAFF_MFA_E2E_RUN_ID||!/^vera_auth_test_[a-f0-9]{32}$/.test(metadata.schema))throw new Error("Verified disposable staff runtime required");
 const url=new URL(process.env.DATABASE_URL??"");if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.port!=="5433")throw new Error("Local PostgreSQL test database required");url.searchParams.set("schema",metadata.schema);
 const db=new PrismaClient({datasources:{db:{url:url.toString()}},log:[]});
 try{
  const user=await db.user.create({data:{email:randomUUID()+"@example.invalid",passwordHash:await argon.hash(password,{type:argon.argon2id,memoryCost:19456,timeCost:2,parallelism:1}),status:"ACTIVE",emailVerifiedAt:new Date()}});
  const activationKey=randomBytes(32).toString("base64url");
  const payload={schemaVersion:1,directiveId:randomUUID(),authorityKeyId:"synthetic-browser-root",subjectId:randomUUID(),userId:user.id,emailDigest:staffEmailDigest(user.email),role:"MODERATOR",state:"ACTIVE",revision:1,mfaEpoch:1,enrollmentKeyHash:staffEnrollmentKeyHash(activationKey),permissions:[],issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};
  const privatePem=await readFile(process.env.VERA_STAFF_MFA_FIXTURE_PRIVATE_PATH!,"utf8");const wire=JSON.stringify({payload,signature:sign(null,staffDirectiveMessage(payload),privatePem).toString("base64url")});
  await new StaffIdentityService(db,new StaffAuthority()).apply(wire);
  return {db,user,activationKey,payload};
 }catch(error){await db.$disconnect();throw error;}
}
async function login(page:Page,email:string){await page.goto("/login?next=/staff-security");await page.getByLabel("Email address").fill(email);await page.getByLabel("Password").fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL(/staff-security/);await expect(page.getByRole("button",{name:"Add authenticator",exact:true})).toBeVisible();}
const otp=(secret:string)=>hotp(decodeTotpSecret(secret),BigInt(Math.floor(Date.now()/30000)));

test("real staff setup, hidden values, recovery, authorization and revocation on desktop/mobile",async({page,context},testInfo)=>{
 test.setTimeout(120000);const f=await fixture();
 try{
  await login(page,f.user.email);expect((await page.request.get("/api/moderation/reports")).status()).toBe(403);
  const old=(await context.cookies()).find(c=>c.name==="vera_e2e_session")!.value;
  await page.getByRole("button",{name:"Add authenticator",exact:true}).click();await page.getByLabel("Current password").fill(password);await page.getByLabel("Staff activation key").fill(f.activationKey);await page.getByRole("button",{name:"Create setup key",exact:true}).click();
  const secret=await page.getByLabel("One-time setup key",{exact:true}).inputValue();expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  // Explicit browser visibility event tests the UI boundary; it is not an MFA mock.
  await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});document.dispatchEvent(new Event("visibilitychange"));});
  await expect(page.getByText("Sensitive values hidden",{exact:true})).toBeVisible();await expect(page.getByLabel("One-time setup key",{exact:true})).toHaveCount(0);
  await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});document.dispatchEvent(new Event("visibilitychange"));});
  await expect(page.getByRole("button",{name:"Confirm authenticator",exact:true})).toBeVisible();await page.getByLabel("Authenticator code").fill(otp(secret));await page.getByRole("button",{name:"Confirm authenticator",exact:true}).click();
  const saved=page.getByRole("region",{name:"Save your recovery codes"});await expect(saved).toBeVisible();const recovery=await saved.locator("code").first().textContent();expect(recovery).toHaveLength(43);
  expect((await context.cookies()).find(c=>c.name==="vera_e2e_session")!.value).not.toBe(old);expect((await page.request.get("/api/moderation/reports")).status()).toBe(200);
  await page.getByRole("button",{name:"I have saved the recovery codes",exact:true}).click();expect((await new AxeBuilder({page}).include(".auth-panel").analyze()).violations).toEqual([]);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:testInfo.outputPath("staff-security-verified.png"),fullPage:true});
  expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  await page.getByRole("button",{name:"Recover access",exact:true}).click();await page.getByLabel("Current password").fill(password);await page.getByLabel(/^Recovery code/).fill(recovery!);await page.getByRole("button",{name:"Use recovery code",exact:true}).click();
  await expect(page.getByText("Recovery accepted. Enroll a new authenticator to restore staff access.",{exact:true})).toBeVisible();expect((await page.request.get("/api/moderation/reports")).status()).toBe(403);
  await expect(page.getByLabel("Staff activation key")).toHaveCount(0);await page.getByLabel("Current password").fill(password);await page.getByRole("button",{name:"Create setup key",exact:true}).click();
  const replacement=await page.getByLabel("One-time setup key",{exact:true}).inputValue();await page.getByLabel("Authenticator code").fill(otp(replacement));await page.getByRole("button",{name:"Confirm authenticator",exact:true}).click();await expect(page.getByRole("region",{name:"Save your recovery codes"})).toBeVisible();await page.getByRole("button",{name:"I have saved the recovery codes",exact:true}).click();
  await page.getByRole("button",{name:"Revoke authenticator",exact:true}).click();await page.getByLabel("Current password").fill(password);await page.getByRole("button",{name:"Revoke authenticator and sign out",exact:true}).click();await expect(page.getByText("Staff sign-in required",{exact:true})).toBeVisible();expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  expect(await f.db.staffMfaEvent.count({where:{subjectId:f.payload.subjectId}})).toBeGreaterThanOrEqual(6);
 }finally{await f.db.$disconnect();}
});
test("MFA quota feedback uses Retry-After and never automatically resubmits",async({page})=>{
 test.setTimeout(90000);const f=await fixture();try{
  await login(page,f.user.email);await page.getByRole("button",{name:"Add authenticator",exact:true}).click();
  for(let i=0;i<5;i++){const response=await page.request.post("/api/auth/staff-mfa/enrollment",{headers:{Origin:"http://localhost:3100"},data:{password,activationKey:randomBytes(32).toString("base64url")}});expect(response.status()).toBe(403);}
  await page.getByLabel("Current password").fill(password);await page.getByLabel("Staff activation key").fill(f.activationKey);let requests=0;page.on("request",r=>{if(r.method()==="POST"&&r.url().endsWith("/staff-mfa/enrollment"))requests++;});
  await page.getByRole("button",{name:"Create setup key",exact:true}).click();await expect(page.getByText("Too many attempts. Wait before trying again.",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Create setup key",exact:true})).toBeDisabled();await expect(page.locator("#mfa-wait")).toContainText("seconds");expect(requests).toBe(1);
  expect((await new AxeBuilder({page}).include(".auth-panel").analyze()).violations).toEqual([]);expect(await f.db.staffMfaDevice.count({where:{subjectId:f.payload.subjectId}})).toBe(0);
 }finally{await f.db.$disconnect();}
});
