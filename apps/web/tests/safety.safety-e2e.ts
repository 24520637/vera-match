import { expect, test, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient, type UserRole } from "@prisma/client";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
async function database() {
  const meta = JSON.parse(
    await readFile(resolve(__dirname, "../.auth-e2e-runtime.json"), "utf8"),
  );
  if (
    meta.kind !== "vera-auth-e2e-v1" ||
    meta.runId !== process.env.VERA_AUTH_E2E_RUN_ID ||
    meta.runId !== process.env.VERA_SAFETY_E2E_RUN_ID ||
    !/^vera_auth_test_[a-f0-9]{32}$/.test(meta.schema)
  )
    throw Error("Isolated safety runtime required");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== "5433"
  )
    throw Error("Local synthetic database required");
  url.searchParams.set("schema", meta.schema);
  return new PrismaClient({
    datasources: { db: { url: url.toString() } },
    log: [],
  });
}
async function account(
  db: PrismaClient,
  role: UserRole = "MEMBER",
  assured = false,
) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.create({
    data: {
      email:
        (assured ? "safety-staff-" : "safety-user-") +
        randomUUID() +
        "@example.invalid",
      passwordHash: "synthetic-only",
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      sessions: {
        create: {
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 600000),
        },
      },
    },
  });
  return { user, token };
}
async function signIn(context: BrowserContext, token: string) {
  await context.addCookies([
    {
      name: "vera_e2e_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("member block/report and scoped moderator review use real services", async ({
  page,
  context,
}, info) => {
  test.setTimeout(120000);
  const db = await database();
  try {
    const member = await account(db),
      target = await account(db),
      staff = await account(db, "MODERATOR", true);
    await signIn(context, member.token);
    await page.goto("/account/safety");
    await expect(
      page.getByText("No blocked accounts", { exact: true }),
    ).toBeVisible();
    const targetInput = page.getByLabel("Account reference to block", {
      exact: false,
    });
    await targetInput.fill(target.user.id);
    await page
      .getByRole("button", { name: "Block account", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Keep account unblocked" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    expect(await db.block.count({ where: { blockerId: member.user.id } })).toBe(
      0,
    );
    await page
      .getByRole("button", { name: "Block account", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm block", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Unblock account " + target.user.id }),
    ).toBeVisible();
    expect(
      await db.block.count({
        where: { blockerId: member.user.id, blockedId: target.user.id },
      }),
    ).toBe(1);
    await page
      .getByRole("button", { name: "Send private report", exact: true })
      .click();
    await expect(
      page.getByLabel("Account reference to report", { exact: false }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Report this account", exact: true })
      .click();
    await page
      .getByLabel("Report reason", { exact: false })
      .selectOption("HARASSMENT");
    const details =
      "SYNTHETIC <script>window.__safetyXss=true</script> harassment context";
    const textarea = page.getByLabel("What happened?", { exact: false });
    await textarea.fill(details);
    let attempts = 0;
    await page.route("**/api/reports", async (route) => {
      attempts++;
      if (attempts < 3)
        await route.fulfill({
          status: attempts === 1 ? 500 : 429,
          headers: attempts === 2 ? { "Retry-After": "1" } : {},
          contentType: "application/json",
          body: JSON.stringify({
            code: attempts === 1 ? "SYNTHETIC_OUTAGE" : "AUTH_RATE_LIMITED",
            message:
              attempts === 1
                ? "Synthetic service outage"
                : "Wait before retrying the report.",
            retryAfterSeconds: 1,
          }),
        });
      else await route.continue();
    });
    const send = page.getByRole("button", {
      name: "Send private report",
      exact: true,
    });
    await send.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Report request not confirmed" }),
    ).toContainText("Synthetic service outage");
    await expect(textarea).toHaveValue(details);
    expect(
      await db.report.count({ where: { reporterId: member.user.id } }),
    ).toBe(0);
    await send.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Report request not confirmed" }),
    ).toContainText("Wait before retrying");
    await expect(textarea).toHaveValue(details);
    await expect(send).toBeEnabled();
    expect(attempts).toBe(2);
    await send.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Your report request was received.", { exact: true }),
    ).toBeVisible();
    await expect(textarea).toHaveValue("");
    const report = await db.report.findFirstOrThrow({
      where: { reporterId: member.user.id, targetUserId: target.user.id },
    });
    expect(report.reason).toBe(details);
    expect(report.status).toBe("OPEN");
    await page
      .getByRole("button", { name: "Unblock account " + target.user.id })
      .click();
    await page
      .getByRole("button", { name: "Keep blocked", exact: true })
      .click();
    expect(await db.block.count({ where: { blockerId: member.user.id } })).toBe(
      1,
    );
    await page
      .getByRole("button", { name: "Unblock account " + target.user.id })
      .click();
    await page
      .getByRole("button", { name: "Remove block", exact: true })
      .click();
    await expect(
      page.getByText("No blocked accounts", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Account closure and erasure are not available in this build.",
        { exact: false },
      ),
    ).toBeVisible();
    expect(
      await page.getByRole("button", { name: /delete account/i }).count(),
    ).toBe(0);
    expect(
      (await new AxeBuilder({ page }).include(".safety-workspace").analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("member-safety.png"),
      fullPage: true,
    });
    await signIn(context, staff.token);
    await page.goto("/moderation/reports");
    const claim = page.getByRole("button", {
      name: "Claim report " + report.id,
      exact: true,
    });
    await expect(claim).toBeVisible();
    expect(
      (await page.request.get("/api/moderation/reports/" + report.id)).status(),
    ).toBe(404);
    await expect(page.getByText(details, { exact: true })).toHaveCount(0);
    await claim.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Claimed report", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(details, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => Object.hasOwn(window, "__safetyXss")),
    ).toBe(false);
    expect(
      (await new AxeBuilder({ page }).include(".safety-workspace").analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("moderation-safety.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Resolve report", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Keep in review", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Keep in review", exact: true })
      .click();
    expect(
      (await db.report.findUniqueOrThrow({ where: { id: report.id } })).status,
    ).toBe("IN_REVIEW");
    await page
      .getByRole("button", { name: "Dismiss report", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm dismissal", exact: true })
      .click();
    await expect(
      page.getByText("Report marked dismissed.", { exact: true }),
    ).toBeVisible();
    expect(
      (await db.report.findUniqueOrThrow({ where: { id: report.id } }))
        .revision,
    ).toBe(2n);
    expect(
      await db.reportModerationAction.count({ where: { reportId: report.id } }),
    ).toBe(2);
    expect(
      await page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
      })),
    ).toEqual({ local: 0, session: 0 });
  } finally {
    await db.$disconnect();
  }
});
test("unassured moderators and ADMIN never see private reports", async ({
  page,
  context,
}) => {
  const db = await database();
  try {
    const member = await account(db),
      target = await account(db),
      mod = await account(db, "MODERATOR"),
      admin = await account(db, "ADMIN", true);
    const report = await db.report.create({
      data: {
        reporterId: member.user.id,
        targetUserId: target.user.id,
        reason: "SYNTHETIC SECRET REPORT",
        reasonCode: "OTHER",
      },
    });
    await signIn(context, mod.token);
    await page.goto("/moderation/reports");
    await expect(
      page.getByRole("alert").filter({ hasText: "Report access unavailable" }),
    ).toContainText("Verified staff assurance");
    expect(
      (await page.request.get("/api/moderation/reports/" + report.id)).status(),
    ).toBe(403);
    await expect(page.getByText(report.reason, { exact: true })).toHaveCount(0);
    await signIn(context, admin.token);
    await page.goto("/moderation/reports");
    await expect(
      page.getByText("Report access denied", { exact: true }),
    ).toBeVisible();
    expect((await page.request.get("/api/moderation/reports")).status()).toBe(
      403,
    );
    await expect(page.getByText(report.reason, { exact: true })).toHaveCount(0);
  } finally {
    await db.$disconnect();
  }
});
