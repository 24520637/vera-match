import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const { createNativeVisibilityRuntime } = require("./native-visibility-runtime.cjs") as {
  createNativeVisibilityRuntime(options:{headless:boolean;viewport:{width:number;height:number}}):Promise<{context:BrowserContext;page:Page;close:()=>Promise<void>}>;
};

test("members accept, reload history and lose the mutual state after a real block", async ({ page: fixturePage, context: fixtureContext, browser }, testInfo) => {
  const runtime = JSON.parse(await readFile(resolve(__dirname, "../.auth-e2e-runtime.json"), "utf8"));
  if (runtime.kind !== "vera-auth-e2e-v1" || runtime.runId !== process.env.VERA_AUTH_E2E_RUN_ID ||
    !/^vera_auth_test_[a-f0-9]{32}$/.test(runtime.schema)) throw new Error("Verified disposable runtime required");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port !== "5433")
    throw new Error("Local PostgreSQL fixture required");
  url.searchParams.set("schema", runtime.schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const peerContext = await browser.newContext({ baseURL: "http://localhost:3100" });
  const nativeRuntime = process.env.VERA_NATIVE_BACKGROUND_E2E === "1" ? await createNativeVisibilityRuntime({
    headless: process.env.VERA_NATIVE_BACKGROUND_HEADLESS === "1", viewport: testInfo.project.use.viewport ?? {width:1440,height:1000},
  }) : undefined;
  const page = nativeRuntime?.page ?? fixturePage, context = nativeRuntime?.context ?? fixtureContext;
  const memberIds: string[] = [];
  const content = "Synthetic matching browser test only.";
  const policyVersion = "browser-fixture-v1";
  const cookie = (value: string) => ({ name: "vera_e2e_session", value, domain: "localhost", path: "/", httpOnly: true });

  try {
    const policy = await db.consentPolicyEvidence.upsert({
      where: { purpose_policyVersion_locale: { purpose: "PROFILE_MATCHING", policyVersion, locale: "en-test" } },
      create: { purpose: "PROFILE_MATCHING", policyVersion, locale: "en-test", content,
        digest: createHash("sha256").update(content).digest("hex"), testOnly: true },
      update: {},
    });
    async function member() {
      const token = randomBytes(32).toString("base64url");
      const account = await db.user.create({ data: {
        email: `${randomUUID()}@example.invalid`, displayName: "Private Fixture Name",
        passwordHash: "synthetic-only", emailVerifiedAt: new Date(), status: "ACTIVE", declaredAdult: true,
        profile: { create: { birthDate: new Date("1990-01-01"), visibilityEnabled: true,
          bio: "PRIVATE_MATCH_BIO", occupation: "PRIVATE_MATCH_OCCUPATION" } },
        sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 600_000) } },
        consentLedger: { create: { subject: { create: {} }, version: 1n } },
        consents: { create: { purpose: "PROFILE_MATCHING", granted: true, grantedAt: new Date(),
          policyVersion, policyEvidenceId: policy.id } },
      } });
      memberIds.push(account.id);
      return { id: account.id, email: account.email, token };
    }

    const a = await member();
    const b = await member();
    await context.addCookies([cookie(a.token)]);
    await peerContext.addCookies([cookie(b.token)]);
    const peer = await peerContext.newPage();
    await page.goto("http://localhost:3100/account");
    await page.getByRole("link", { name: "Discover & matches" }).click();
    await expect(page.getByRole("heading", { name: "Meet someone new." })).toBeVisible();
    await expect(page.getByText("Private Fixture Name")).toHaveCount(0);
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByText("Acceptance saved.")).toBeVisible();
    await expect(page.getByText("Mutual match")).toHaveCount(0);

    await peer.goto("/account/matches");
    await peer.getByRole("button", { name: "Accept", exact: true }).click();
    await peer.getByRole("button", { name: "All activity", exact: true }).click();
    await expect(peer.getByText("Accepted ·", { exact: false })).toContainText("Mutual match");
    await page.reload();
    await page.getByRole("button", { name: "All activity", exact: true }).click();
    await expect(page.getByText("Accepted ·", { exact: false })).toContainText("Mutual match");
    expect((await new AxeBuilder({ page }).include(".member-settings").analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const nativeBackground = process.env.VERA_NATIVE_BACKGROUND_E2E === "1";
    if (nativeBackground) {
      await page.bringToFront();
      await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("visible");
      await expect(page.getByText("Accepted ·", { exact: false })).toContainText("Mutual match");
    }
    const backgroundTab = nativeBackground ? await context.newPage() : undefined;
    if (backgroundTab) {
      await backgroundTab.bringToFront();
      await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("hidden");
      await expect(page.getByText("Mutual match")).toHaveCount(0);
    }
    const blocked = await peer.request.post("/api/blocks", {
      headers: { origin: "http://localhost:3100" }, data: { targetUserId: a.id },
    });
    expect(blocked.status()).toBe(204);
    if (backgroundTab) {
      const reauthorized = page.waitForResponse(response => response.url().endsWith("/api/matches/recommendations") && response.ok());
      await page.bringToFront();
      await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("visible");
      await reauthorized;
      await backgroundTab.close();
    } else { await page.reload(); await page.getByRole("button", { name: "All activity", exact: true }).click(); }
    await expect(page.getByText("Accepted ·", { exact: false })).toContainText("Unavailable");
    await expect(page.getByText("Mutual match")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);

    // A fresh history navigation must reauthorize; cached mutual state is not authority.
    await page.goto("http://localhost:3100/account/profile");
    await page.goBack();
    await page.getByRole("button", { name: "All activity", exact: true }).click();
    await expect(page.getByText("Accepted ·", { exact: false })).toContainText("Unavailable");
    expect((await peer.request.delete("/api/blocks/" + a.id, {
      data: {}, headers: { origin: "http://localhost:3100" },
    })).status()).toBe(204);
    const refocused = page.waitForResponse(response => response.url().endsWith("/api/matches/recommendations") && response.ok());
    await page.evaluate(() => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); });
    await refocused;
    await expect(page.getByText("Accepted ·", { exact: false })).toContainText("Unavailable");
    await expect(page.getByText("Mutual match")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);

    const withdrawing = await member();
    const legacy = await member();
    await db.profile.update({ where: { userId: legacy.id }, data: { birthDate: new Date("1990-01-01T01:00:00Z") } });
    const recommendationResponse = page.waitForResponse(response => response.url().endsWith("/api/matches/recommendations") && response.ok());
    await page.reload();
    const projection = await (await recommendationResponse).json();
    expect(projection.recommendations).toHaveLength(1);
    expect(JSON.stringify(projection)).not.toMatch(/PRIVATE_MATCH|Private Fixture Name|1990-01-01/);
    expect(JSON.stringify(projection)).not.toContain(withdrawing.id);
    expect(JSON.stringify(projection)).not.toContain(withdrawing.email);
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(1);

    await peerContext.addCookies([cookie(withdrawing.token)]);
    const revoked = await peer.request.patch("/api/consents/me", {
      headers: { origin: "http://localhost:3100", "idempotency-key": randomUUID() },
      data: { expectedVersion: 1, consents: [{ purpose: "PROFILE_MATCHING", granted: false }] },
    });
    expect(revoked.status(), await revoked.text()).toBe(200);
    const staleConsent = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/decision"));
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    expect((await staleConsent).status()).toBe(404);
    await expect(page.getByText("This recommendation is no longer available.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);

    const blocking = await member();
    await page.getByRole("button", { name: "Refresh matches" }).click();
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(1);
    await peerContext.addCookies([cookie(blocking.token)]);
    expect((await peer.request.post("/api/blocks", {
      headers: { origin: "http://localhost:3100" }, data: { targetUserId: a.id },
    })).status()).toBe(204);
    const staleBlock = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/decision"));
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    expect((await staleBlock).status()).toBe(404);
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    expect(await db.matchDecision.count({ where: { actorUserId: a.id } })).toBe(1);

    await member();
    await page.getByRole("button", { name: "Refresh matches" }).click();
    await page.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(page.getByText("Decline saved.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "All activity", exact: true }).click();
    await expect(page.getByText("Declined ·", { exact: false })).toBeVisible();
  } finally {
    await peerContext.close();
    await db.user.deleteMany({ where: { id: { in: memberIds } } });
    await db.$disconnect();
    await nativeRuntime?.close();
  }
});
