import { expect, test, BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hash, argon2id } from "argon2";

test.describe("Real signed consent publication", () => {
  async function member(context: BrowserContext) {
    const metadata = JSON.parse(await readFile(resolve(__dirname,"../.auth-e2e-runtime.json"),"utf8"));
    if (metadata.kind !== "vera-auth-e2e-v1" || metadata.runId !== process.env.VERA_AUTH_E2E_RUN_ID || !/^vera_auth_test_[a-f0-9]{32}$/.test(metadata.schema)) throw Error("Verified disposable runtime required");
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["localhost","127.0.0.1","[::1]"].includes(url.hostname) || url.port !== "5433") throw Error("Local disposable test database required");
    url.searchParams.set("schema",metadata.schema);
    const db = new PrismaClient({ datasources:{db:{url:url.toString()}},log:[] });
    const password = "synthetic-policy-browser-password";
    const user = await db.user.create({data:{email:"policy-ui-"+randomUUID()+"@example.invalid",passwordHash:await hash(password,{type:argon2id,memoryCost:19456,timeCost:2,parallelism:1}),declaredAdult:true,status:"ACTIVE",emailVerifiedAt:new Date()}});
    const response = await context.request.post("http://localhost:3100/api/auth/login",{headers:{Origin:"http://localhost:3100"},data:{email:user.email,password}});
    expect(response.status()).toBe(200);
    return {db,user,async close(){try{await db.user.deleteMany({where:{id:user.id}});}finally{await db.$disconnect();}}};
  }
  test("member explicitly grants the displayed locale/digest, reloads and withdraws without restoring old generations",async({page,context},testInfo)=>{
    test.setTimeout(120000);const fixture=await member(context);
    try{
      const published=await context.request.get("http://localhost:3100/api/consents/policies?locale=vi");expect(published.status()).toBe(200);
      const catalog=await published.json();expect(catalog.policies).toHaveLength(5);
      const notice=catalog.policies.find((p:{purpose:string})=>p.purpose==="VIDEO_STORAGE");
      await page.goto("/account/consents");
      await expect(page.getByLabel("Consent notice language")).toBeEnabled();
      await page.getByLabel("Consent notice language").selectOption("vi");
      const group=page.getByRole("group",{name:"Video storage",exact:true});
      await group.getByText('Read policy '+notice.policyVersion+' (vi)',{exact:true}).click();
      await expect(group.locator('[lang="vi"]')).toHaveText(notice.content);
      const checkbox=group.getByRole("checkbox");await expect(checkbox).not.toBeChecked();
      await expect(group.getByRole("button",{name:"Grant video storage",exact:true})).toBeDisabled();
      await checkbox.focus();await page.keyboard.press("Space");
      await page.screenshot({path:testInfo.outputPath("consent-notice-vi.png"),fullPage:true});
      const sent=page.waitForRequest(r=>r.url().endsWith("/api/consents/me")&&r.method()==="PATCH");
      await group.getByRole("button",{name:"Grant video storage",exact:true}).click();
      expect((await sent).postDataJSON()).toEqual({expectedVersion:0,consents:[{purpose:"VIDEO_STORAGE",granted:true,policyVersion:notice.policyVersion,locale:"vi",policyDigest:notice.digest}]});
      await expect(group).toContainText("Current choice: ON");
      const row=await fixture.db.consent.findUniqueOrThrow({where:{userId_purpose:{userId:fixture.user.id,purpose:"VIDEO_STORAGE"}},include:{policyEvidence:true}});
      expect(row.policyEvidence).toMatchObject({locale:"vi",content:notice.content,digest:notice.digest,testOnly:false});
      expect(await fixture.db.consent.count({where:{userId:fixture.user.id,granted:true}})).toBe(1);
      await page.reload();await expect(group).toContainText("Current choice: ON");
      await expect(group.getByRole("checkbox")).not.toBeChecked();
      await group.getByRole("button",{name:"Withdraw video storage",exact:true}).click();
      await expect(group).toContainText("Current choice: OFF");
      const subject=await fixture.db.consentLedger.findUniqueOrThrow({where:{userId:fixture.user.id}});
      expect(await fixture.db.consentWithdrawalTask.count({where:{subjectId:subject.subjectId,purpose:"VIDEO_STORAGE",version:2n}})).toBe(1);
      await expect(page.getByLabel("Consent notice language")).toBeEnabled();
      await group.getByRole("checkbox").check();await group.getByRole("button",{name:"Grant video storage",exact:true}).click();
      await expect(group).toContainText("Current choice: ON");
      expect(await fixture.db.consentWithdrawalTask.count({where:{subjectId:subject.subjectId,purpose:"VIDEO_STORAGE",version:2n}})).toBe(1);
      expect((await new AxeBuilder({page}).include(".member-settings").analyze()).violations).toEqual([]);
      expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,overflow:document.documentElement.scrollWidth>innerWidth}))).toEqual({local:0,session:0,overflow:false});
    }finally{await fixture.close();}
  });
  test("corrupt delivered notices disable grants without disabling actual withdrawal",async({page,context})=>{
    test.setTimeout(120000);const fixture=await member(context);
    try{
      const catalog=await(await context.request.get("http://localhost:3100/api/consents/policies?locale=en")).json();
      const notice=catalog.policies.find((p:{purpose:string})=>p.purpose==="VIDEO_STORAGE");
      const granted=await context.request.patch("http://localhost:3100/api/consents/me",{headers:{Origin:"http://localhost:3100","Idempotency-Key":randomUUID()},data:{expectedVersion:0,consents:[{purpose:"VIDEO_STORAGE",granted:true,policyVersion:notice.policyVersion,locale:"en",policyDigest:notice.digest}]}});expect(granted.status()).toBe(200);
      await page.route("**/api/consents/policies**",async route=>{const actual=await route.fetch();const body=await actual.json();body.policies[0].digest="0".repeat(64);await route.fulfill({response:actual,json:body});});
      await page.goto("/account/consents");
      await expect(page.getByText("Consent notices could not be verified.",{exact:true})).toBeVisible();
      const group=page.getByRole("group",{name:"Video storage",exact:true});
      await expect(group.getByRole("button",{name:"Grant video storage",exact:true})).toBeDisabled();
      await expect(group.getByRole("button",{name:"Withdraw video storage",exact:true})).toBeEnabled();
      await group.getByRole("button",{name:"Withdraw video storage",exact:true}).click();
      await expect(group).toContainText("Current choice: OFF");
      expect((await fixture.db.consent.findUniqueOrThrow({where:{userId_purpose:{userId:fixture.user.id,purpose:"VIDEO_STORAGE"}}})).granted).toBe(false);
      await expect(page.getByLabel("Consent notice language")).toBeEnabled();
    }finally{await fixture.close();}
  });
});
