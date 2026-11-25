import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { purposes, purposeLabels, questions } from "../src/lib/member-contracts";

test("real member screens persist through refresh, safely recover from conflict and withdraw each purpose", async ({ page, context }) => {
  test.setTimeout(120000);
  const metadata = JSON.parse(await readFile(resolve(__dirname, "../.auth-e2e-runtime.json"), "utf8"));
  if (metadata.kind !== "vera-auth-e2e-v1" || metadata.runId !== process.env.VERA_AUTH_E2E_RUN_ID || !/^vera_auth_test_[a-f0-9]{32}$/.test(metadata.schema)) {
    throw new Error("Verified disposable runtime required");
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port !== "5433") throw new Error("Local test database required");
  url.searchParams.set("schema", metadata.schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const token = randomBytes(32).toString("base64url");
  let userId: string | undefined;
  try {
    const user = await db.user.create({ data: { email: `member-ui-${randomUUID()}@example.invalid`,
      passwordHash: "synthetic-fixture-not-for-login", role: "MEMBER", status: "ACTIVE", emailVerifiedAt: new Date(),
      sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } },
    } });
    userId = user.id;
    await context.addCookies([{ name: "vera_e2e_session", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/account/profile");
    await page.getByLabel("City", { exact: true }).fill("Synthetic home");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Your changes were saved.")).toBeVisible();
    await page.reload(); await expect(page.getByLabel("City", { exact: true })).toHaveValue("Synthetic home");
    await page.getByLabel("City", { exact: true }).fill("My revised city");
    await db.$transaction(async tx => {
      await tx.memberResourceRevision.update({ where: { userId_resource: { userId: user.id, resource: "PROFILE" } }, data: { revision: { increment: 1n } } });
      await tx.profile.update({ where: { userId: user.id }, data: { city: "Other device city" } });
    });
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Load latest version for review" })).toBeVisible();
    await expect(page.getByLabel("City", { exact: true })).toHaveValue("My revised city");
    await page.getByRole("button", { name: "Load latest version for review" }).click();
    await page.getByLabel("I reviewed the latest saved data and want to submit my edits.").check();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Your changes were saved.")).toBeVisible();
    expect((await db.memberResourceRevision.findUniqueOrThrow({ where: { userId_resource: { userId: user.id, resource: "PROFILE" } } })).revision).toBe(3n);

    await page.getByText("Preferences, privacy & more", { exact: true }).click();
    await page.getByRole("link", { name: "Your questionnaire", exact: true }).click();
    for (const q of questions) await page.getByLabel(q.prompt).fill(`Synthetic ${q.key}`);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Your changes were saved.")).toBeVisible();
    await page.reload();
    for (const q of questions) await expect(page.getByLabel(q.prompt)).toHaveValue(`Synthetic ${q.key}`);
    expect(await db.questionnaireAnswer.count({ where: { userId: user.id, questionnaireVersion: 1 } })).toBe(3);

    await page.getByText("Preferences, privacy & more", { exact: true }).click();
    await page.getByRole("link", { name: "Your preferences", exact: true }).click();
    await page.getByLabel("Minimum age").fill("30"); await page.getByLabel("Maximum age").fill("45");
    await page.getByLabel("Relationship goal", { exact: true }).selectOption("exploring");
    await page.getByRole("group", { name: "Priority order", exact: true }).getByLabel("values", { exact: true }).check();
    await page.getByRole("group", { name: "Priority order", exact: true }).getByLabel("interests", { exact: true }).check();
    await page.getByRole("button", { name: "Move interests earlier" }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Your changes were saved.")).toBeVisible();
    await page.reload(); await expect(page.getByLabel("Minimum age")).toHaveValue("30");
    expect((await db.matchPreference.findUniqueOrThrow({ where: { userId: user.id } })).priorities).toEqual(["interests", "values"]);
    expect((await db.matchPreference.findUniqueOrThrow({ where: { userId: user.id } })).dealBreakers).toBeNull();
    // Scope C024 accessibility to the new settings. The shared header's pre-existing
    // wordmark label-content-name-mismatch is recorded in the implementation notes.
    expect((await new AxeBuilder({ page }).include(".member-settings").analyze()).violations).toEqual([]);

    // Synthetic legacy rows exercise withdrawal without inventing an approved policy.
    await db.consent.createMany({ data: purposes.map(purpose => ({ userId: user.id, purpose, granted: true, grantedAt: new Date() })) });
    await page.getByText("Preferences, privacy & more", { exact: true }).click();
    await page.getByRole("link", { name: "Your consent choices", exact: true }).click();
    for (const purpose of purposes) {
      await expect(page.getByRole("button", { name: `Grant ${purposeLabels[purpose].toLowerCase()}`, exact: true })).toBeDisabled();
      await page.getByRole("button", { name: `Withdraw ${purposeLabels[purpose].toLowerCase()}`, exact: true }).click();
      await expect(page.getByText("Request recorded. The current consent choices are shown below.")).toBeVisible();
      await expect(page.getByRole("group", { name: purposeLabels[purpose], exact: true })).toContainText("Current choice: OFF");
    }
    await page.reload();
    for (const purpose of purposes) await expect(page.getByRole("group", { name: purposeLabels[purpose], exact: true })).toContainText("Current choice: OFF");
    const ledger = await db.consentLedger.findUniqueOrThrow({ where: { userId: user.id } });
    expect(ledger.version).toBe(5n);
    expect(await db.consentEvent.count({ where: { subjectId: ledger.subjectId } })).toBe(5);
    expect(await db.consentWithdrawalTask.count({ where: { subjectId: ledger.subjectId, status: "PENDING" } })).toBe(5);
    expect(await db.consent.count({ where: { userId: user.id, granted: true } })).toBe(0);
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
