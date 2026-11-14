import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  readActivationEmail,
  clearTestEmails,
} from "../../api/test/mailpit-fixtures";

test("restores a real HttpOnly session after refresh and browser-context reopen", async ({
  page,
  context,
  browser,
}) => {
  const email = `browser-${randomUUID()}@example.invalid`;
  const password = "synthetic-browser-password";
  const post = (path: string, data: object) =>
    context.request.post(`http://localhost:4100/api/auth/${path}`, {
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
    await page.goto("/account");
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
        cookie: document.cookie,
      })),
    ).toEqual({ local: 0, session: 0, cookie: "" });
    const stored = await context.storageState();
    expect(
      stored.cookies.some(
        (cookie) => cookie.httpOnly && cookie.expires > Date.now() / 1000,
      ),
    ).toBe(true);
    const reopened = await browser.newContext({ storageState: stored });
    try {
      const other = await reopened.newPage();
      await other.goto("http://localhost:3100/account");
      await expect(other.getByText(email, { exact: true })).toBeVisible();
    } finally {
      await reopened.close();
    }
  } finally {
    await clearTestEmails(email);
  }
});

test("uses real sign-in, rejects external next targets and remembers only explicitly selected email", async ({
  page,
  context,
}) => {
  const email = `browser-${randomUUID()}@example.invalid`;
  const password = "synthetic-browser-password";
  const post = (path: string, data: object) =>
    context.request.post(`http://localhost:4100/api/auth/${path}`, {
      headers: { Origin: "http://localhost:3100" },
      data,
    });
  try {
    await post("register", { email, password, declaredAdult: true });
    const activation = await readActivationEmail(email);
    await post("verify-email", { token: activation.token });
    await page.goto("/login?next=https://attacker.invalid");
    const form = page.getByRole("form", { name: "Sign in", exact: true });
    await form.getByLabel("Email address").fill(email);
    await form.getByLabel("Password", { exact: false }).fill(password);
    await form.getByLabel("Remember email on this device").check();
    await form.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/account");
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([
      ["vera.rememberedEmail", email],
    ]);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
    await page.goto("/login?next=//attacker.invalid");
    await expect(page).toHaveURL("/account");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page
        .getByRole("form", { name: "Sign in", exact: true })
        .getByLabel("Email address"),
    ).toHaveValue(email);
    await page.getByLabel("Remember email on this device").uncheck();
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally {
    await clearTestEmails(email);
  }
});

test("confirms logout-all and invalidates independently issued sessions in two browsers", async ({
  page,
  context,
  browser,
}) => {
  const email = `browser-${randomUUID()}@example.invalid`;
  const password = "synthetic-browser-password";
  const second = await browser.newContext();
  const post = (path: string, data: object) =>
    context.request.post(`http://localhost:4100/api/auth/${path}`, {
      headers: { Origin: "http://localhost:3100" },
      data,
    });
  try {
    await post("register", { email, password, declaredAdult: true });
    const activation = await readActivationEmail(email);
    await post("verify-email", { token: activation.token });
    await post("login", { email, password });
    await second.request.post("http://localhost:4100/api/auth/login", {
      headers: { Origin: "http://localhost:3100" },
      data: { email, password },
    });
    const other = await second.newPage();
    await other.goto("http://localhost:3100/account");
    await expect(other.getByText(email, { exact: true })).toBeVisible();
    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out on all devices" }).click();
    const dialog = page.getByRole("dialog", { name: "Sign out everywhere?" });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await expect(
      dialog.getByRole("button", { name: "Keep me signed in" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Sign out on all devices" }).click();
    await dialog
      .getByRole("button", { name: "Sign out everywhere", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login/);
    await other.reload();
    await expect(other).toHaveURL(/\/login/);
  } finally {
    await second.close();
    await clearTestEmails(email);
  }
});

test("registers, verifies a real email link and signs in through accessible forms", async ({
  page,
}) => {
  const email = `browser-${randomUUID()}@example.invalid`;
  const password = "🔐".repeat(65);
  try {
    await page.goto("/register");
    const form = page.getByRole("form", {
      name: "Create account",
      exact: true,
    });
    await form
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(form.getByLabel("Email address")).toBeFocused();
    await form.getByLabel("Display name (optional)").fill("Synthetic Member");
    await form.getByLabel("Email address").fill(email);
    await form.getByLabel(/^Password \(required\)$/).fill(password);
    await form.getByLabel(/^Confirm password \(required\)$/).fill(password);
    await form
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      form.getByLabel("I declare that I am 18 or older"),
    ).toBeFocused();
    await form.getByLabel("I declare that I am 18 or older").check();
    await form
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Check your inbox." }),
    ).toBeFocused();
    expect(
      (await page.context().cookies()).some(
        (cookie) => cookie.name === "vera_e2e_session",
      ),
    ).toBe(false);
    const activation = await readActivationEmail(email);
    await page.goto(activation.link);
    await expect(page).toHaveURL("/verify-email");
    await page
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Email verified." }),
    ).toBeFocused();
    await page
      .getByRole("main")
      .getByRole("link", { name: "Sign in", exact: true })
      .click();
    const login = page.getByRole("form", { name: "Sign in", exact: true });
    await login.getByLabel("Email address").fill(email);
    await login.getByLabel(/^Password \(required\)$/).fill(password);
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/account");
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login/);
    await page.goto(activation.link);
    await page
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(
      page.getByText("This link cannot be used.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Request another email", exact: true })
      .click();
    await page.getByLabel("Email address").fill(email);
    await page
      .getByRole("button", { name: "Request activation email" })
      .click();
    await expect(
      page.getByText("Activation request received.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Request activation email" }),
    ).toBeDisabled();
  } finally {
    await clearTestEmails(email);
  }
});

test("auth pages preserve accessible keyboard forms and fit a 320px viewport", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of [
    "/register",
    "/login",
    "/resend-verification",
    "/verify-email",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
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
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
      "BODY",
    );
  }
});
