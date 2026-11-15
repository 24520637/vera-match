import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  clearTestEmails,
  readActivationEmail,
  readResetEmail,
} from "../../api/test/mailpit-fixtures";

test("recovers through real SMTP and forms, revokes two independent browser sessions, then signs in", async ({
  page,
  context,
  browser,
}, testInfo) => {
  const email = `recovery-browser-${randomUUID()}@example.invalid`;
  const password = "synthetic-recovery-old-password";
  const newPassword = "synthetic-recovery-new-password";
  const other = await browser.newContext();
  const post = (path: string, data: object) =>
    context.request.post(`/api/auth/${path}`, {
      headers: { Origin: "http://localhost:3100" },
      data,
    });
  try {
    expect(
      (
        await post("register", { email, password, declaredAdult: true })
      ).status(),
    ).toBe(202);
    const activation = await readActivationEmail(email);
    expect(
      (await post("verify-email", { token: activation.token })).status(),
    ).toBe(200);
    expect((await post("login", { email, password })).status()).toBe(200);
    expect(
      (
        await other.request.post("http://localhost:3100/api/auth/login", {
          headers: { Origin: "http://localhost:3100" },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    await page.goto("/forgot-password");
    await page.getByRole("button", { name: "Request reset link" }).click();
    await expect(page.getByLabel("Email address")).toBeFocused();
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Request reset link" }).click();
    await expect(
      page.getByText("Request received.", { exact: true }),
    ).toBeVisible();
    const mail = await readResetEmail(email, [activation.id]);
    await page.goto(mail.link);
    await expect(page).toHaveURL("/reset-password");
    const form = page.getByRole("form", {
      name: "Reset password",
      exact: true,
    });
    await form.getByRole("button", { name: "Update password" }).click();
    await expect(form.getByLabel(/^New password/)).toBeFocused();
    await form.getByLabel(/^New password/).fill(newPassword);
    await form.getByLabel(/^Confirm new password/).fill("different-password");
    await form.getByRole("button", { name: "Update password" }).click();
    await expect(form.getByLabel(/^Confirm new password/)).toBeFocused();
    await form.getByLabel(/^Confirm new password/).fill(newPassword);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("reset-password.png"),
      fullPage: true,
    });
    await form.getByRole("button", { name: "Update password" }).click();
    await expect(
      page.getByRole("heading", { name: "Password updated." }),
    ).toBeFocused();
    expect(await page.locator('input[type="password"]').count()).toBe(0);
    expect((await context.request.get("/api/auth/me")).status()).toBe(401);
    expect(
      (await other.request.get("http://localhost:3100/api/auth/me")).status(),
    ).toBe(401);
    expect((await post("login", { email, password })).status()).toBe(401);
    expect(
      (
        await post("reset-password", { token: mail.token, newPassword })
      ).status(),
    ).toBe(400);
    await page
      .getByRole("main")
      .getByRole("link", { name: "Sign in", exact: true })
      .click();
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel(/^Password \(required\)$/).fill(newPassword);
    await page
      .getByRole("form", { name: "Sign in", exact: true })
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(page).toHaveURL("/account");
    expect(
      await page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
        cookie: document.cookie,
      })),
    ).toEqual({ local: 0, session: 0, cookie: "" });
  } finally {
    await other.close();
    await clearTestEmails(email);
  }
});

test("recovery pages are accessible and responsive, with an explicit missing-link recovery action", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of ["/forgot-password", "/reset-password"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(path.slice(1) + ".png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByRole("link", { name: "Request a new reset link" }),
  ).toBeVisible();
});
