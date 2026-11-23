import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { argon2id, hash } from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test.use({trace:"off"}); // Never record a bearer status fragment in a browser trace.
async function fixture() {
  const runtime=JSON.parse(await readFile(resolve(__dirname,"../.auth-e2e-runtime.json"),"utf8"));
  const url=new URL(process.env.DATABASE_URL ?? "");
  if(runtime.kind !== "vera-auth-e2e-v1" || runtime.runId !== process.env.VERA_AUTH_E2E_RUN_ID ||
    !/^vera_auth_test_[a-f0-9]{32}$/.test(runtime.schema) || !["localhost","127.0.0.1","[::1]"].includes(url.hostname) || url.port !== "5433")throw Error("Disposable closure runtime required");
  url.searchParams.set("schema",runtime.schema);
  const db=new PrismaClient({datasources:{db:{url:url.toString()}},log:[]});
  const token=randomBytes(32).toString("base64url"),password="synthetic-closure-browser-password";
  const user=await db.user.create({data:{email:randomUUID()+"@closure.example.invalid",passwordHash:await hash(password,{type:argon2id,memoryCost:19456,timeCost:2,parallelism:1}),
    status:"ACTIVE",role:"MEMBER",emailVerifiedAt:new Date(),declaredAdult:true,
    sessions:{create:{tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+600000)}}}});
  return {db,user,password,cookie:{name:"vera_e2e_session",value:token,domain:"localhost",path:"/",httpOnly:true,sameSite:"Lax" as const}};
}
async function mailedToken(email:string) {
  for(const until=Date.now()+15000;Date.now()<until;) {
    const search=await(await fetch("http://127.0.0.1:8025/api/v1/search?query="+encodeURIComponent("to:"+email))).json() as {messages?:{ID:string}[]};
    if(search.messages?.length) {
      const mail=await(await fetch("http://127.0.0.1:8025/api/v1/message/"+search.messages[0].ID)).json() as {Text:string};
      const value=/#token=([A-Za-z0-9_-]{43})/.exec(mail.Text)?.[1];if(value)return value;
    }
    await new Promise(r=>setTimeout(r,50));
  }
  throw Error("Synthetic closure email not received");
}

test("member closure requires fresh proof, handles throttling and verifies emailed status without a session",async({page,context})=>{
  const f=await fixture();
  try {
    await context.addCookies([f.cookie]);
    const peer=await context.newPage();await peer.goto("/account/profile");
    await peer.getByLabel("City",{exact:true}).fill("PRIVATE_UNSAVED_CLOSURE_DRAFT");
    await page.goto("/account/closure");
    await expect(page.getByRole("heading",{name:"Close your account",exact:true})).toBeVisible();
    await expect(page.getByLabel("Current password",{exact:false})).toBeVisible();
    expect((await new AxeBuilder({page}).include(".member-settings").analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath("closure-confirmation.png"),fullPage:true});
    await page.getByLabel("Current password",{exact:false}).fill("wrong");
    await page.getByLabel("Confirm account closure",{exact:false}).fill("CLOSE MY ACCOUNT");
    await page.getByRole("button",{name:"Close my account",exact:true}).click();
    await page.screenshot({path:test.info().outputPath("closure-confirmation-dialog.png"),fullPage:true});
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button",{name:"Close my account",exact:true})).toBeFocused();
    await expect(page.getByLabel("Current password",{exact:false})).toHaveValue("");
    expect(await f.db.accountClosure.count({where:{userId:f.user.id}})).toBe(0);
    await page.getByLabel("Current password",{exact:false}).fill("wrong");
    await page.getByLabel("Confirm account closure",{exact:false}).fill("CLOSE MY ACCOUNT");
    await page.getByRole("button",{name:"Close my account",exact:true}).click();
    await page.getByRole("button",{name:"Confirm closure",exact:true}).click();
    await expect(page.getByText("Check your current password and confirmation.",{exact:true}).first()).toBeVisible();
    expect((await f.db.user.findUniqueOrThrow({where:{id:f.user.id}})).status).toBe("ACTIVE");
    await page.route("**/api/account-closure",route=>route.fulfill({status:429,contentType:"application/json",headers:{"Retry-After":"1"},body:JSON.stringify({code:"AUTH_RATE_LIMITED",message:"Please wait.",retryAfterSeconds:1})}),{times:1});
    await page.getByLabel("Current password",{exact:false}).fill(f.password);
    await page.getByLabel("Confirm account closure",{exact:false}).fill("CLOSE MY ACCOUNT");
    await page.getByRole("button",{name:"Close my account",exact:true}).click();
    await page.getByRole("button",{name:"Confirm closure",exact:true}).click();
    await expect(page.getByText("Too many attempts. Wait, then choose whether to submit again.")).toBeVisible();
    await expect(page.getByRole("button",{name:"Close my account",exact:true})).toBeEnabled();
    expect(await f.db.accountClosure.count({where:{userId:f.user.id}})).toBe(0);
    await page.getByLabel("Current password",{exact:false}).fill(f.password);
    await page.getByLabel("Confirm account closure",{exact:false}).fill("CLOSE MY ACCOUNT");
    const accepted=page.waitForResponse(r=>r.url().endsWith("/api/account-closure") && r.status()===202);
    await page.getByRole("button",{name:"Close my account",exact:true}).click();
    await page.getByRole("button",{name:"Confirm closure",exact:true}).click();await accepted;
    await expect(page).toHaveURL(/\/closure-status$/);
    await expect(peer).toHaveURL(/\/login/);
    await expect(peer.locator('input[value="PRIVATE_UNSAVED_CLOSURE_DRAFT"]')).toHaveCount(0);
    expect((await context.cookies()).some(c=>c.name==="vera_e2e_session")).toBe(false);
    const token=await mailedToken(f.user.email);
    await page.goto("/closure-status#token="+token);
    await expect(page).toHaveURL(/\/closure-status$/);
    await page.getByRole("button",{name:"Check closure progress",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Access remains closed"})).toBeFocused();
    await expect(page.getByText("Cleanup and retention remain pending")).toBeVisible();
    expect((await new AxeBuilder({page}).include(".auth-shell").analyze()).violations).toEqual([]);
    await page.screenshot({path:test.info().outputPath("closure-status-verified.png"),fullPage:true});
    const storage=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}));
    for(const secret of [token,f.password,"PRIVATE_UNSAVED_CLOSURE_DRAFT"])expect(JSON.stringify(storage)).not.toContain(secret);
    const replay=await page.request.post("/api/account-closure/status",{headers:{Origin:"http://localhost:3100"},data:{token}});
    expect(replay.status()).toBe(400);
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    await peer.close();
  } finally {await f.db.$disconnect();} // Global fixture teardown drops only the nonce-owned schema; no User.delete shortcut.
});

test("lost acknowledgement after real closure commit never triggers an automatic retry",async({page,context})=>{
  const f=await fixture();let requests=0;
  try {
    await context.addCookies([f.cookie]);await page.goto("/account/closure");
    await page.route("**/api/account-closure",async route=>{requests++;const real=await route.fetch();expect(real.status()).toBe(202);await route.abort("failed");},{times:1});
    await page.getByLabel("Current password",{exact:false}).fill(f.password);
    await page.getByLabel("Confirm account closure",{exact:false}).fill("CLOSE MY ACCOUNT");
    await page.getByRole("button",{name:"Close my account",exact:true}).click();
    await page.getByRole("button",{name:"Confirm closure",exact:true}).click();
    await expect(page.getByText("The result could not be confirmed. Check your closure status email before taking any further action.")).toBeVisible();
    await expect(page.getByRole("button",{name:"Close my account",exact:true})).toBeDisabled();
    expect((await f.db.user.findUniqueOrThrow({where:{id:f.user.id}})).status).toBe("CLOSED");
    await page.waitForTimeout(1100);expect(requests).toBe(1);
    await page.getByRole("button",{name:"Check closure status",exact:true}).click();await expect(page).toHaveURL(/\/closure-status$/);
  } finally {await f.db.$disconnect();}
});

test("an unreleased deployment never requests a closure password",async({page,context})=>{
 const f=await fixture();
 try {
 await context.addCookies([f.cookie]);
 // UI-only release-state fixture; the actual production API gate is tested in C065 PostgreSQL integration.
 await page.route("**/api/account-closure/availability",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:false})}));
 await page.goto("/account/closure");
 await expect(page.getByText("Release review pending",{exact:true})).toBeVisible();
 await expect(page.getByLabel("Current password",{exact:false})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Close my account",exact:true})).toHaveCount(0);
 } finally {await f.db.$disconnect();}
});
