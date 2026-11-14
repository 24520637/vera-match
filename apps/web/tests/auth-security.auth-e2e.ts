import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  readActivationEmail,
  clearTestEmails,
} from "../../api/test/mailpit-fixtures";

test("keeps outages distinct from logout and retries failed sign-out against the real session", async ({
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
    await post("login", { email, password });
    for (const status of [500, 503, 403]) {
      await page.route("**/auth/me", (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          headers: {
            "Access-Control-Allow-Origin": "http://localhost:3100",
            "Access-Control-Allow-Credentials": "true",
          },
          body: JSON.stringify({ message: "Synthetic service failure" }),
        }),
      );
      await page.goto("/account");
      await expect(
        page.getByText(
          status === 403
            ? "This account cannot open this page."
            : "We could not check your session.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page).toHaveURL("/account");
      await expect(page.getByText(email, { exact: true })).not.toBeVisible();
      await page.unroute("**/auth/me");
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByText(email, { exact: true })).toBeVisible();
    }
    await page.route("**/auth/me", (route) => route.abort("failed"));
    await page.reload();
    await expect(
      page.getByText("We could not check your session.", { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL("/account");
    await page.unroute("**/auth/me");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.clock.install();
    let limitedRequests = 0;
    await page.route("**/auth/logout", (route) => {
      limitedRequests++;
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "http://localhost:3100",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Expose-Headers": "Retry-After",
          "Retry-After": "2",
        },
        body: JSON.stringify({
          code: "RATE_LIMITED",
          message: "Too many attempts. Try again later.",
          retryAfterSeconds: 2,
        }),
      });
    });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.locator("#logout-retry-after")).toHaveText(
      "You can try again in 2 seconds.",
    );
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page).toHaveURL("/account");
    await page.clock.fastForward(2100);
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeEnabled();
    expect(limitedRequests).toBe(1);
    await page.unroute("**/auth/logout");
    await page.route("**/auth/logout", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByText("Sign-out could not be confirmed.", { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL("/account");
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    expect(
      (await context.request.get("http://localhost:4100/api/auth/me")).status(),
    ).toBe(200);
    await page.unroute("**/auth/logout");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(
      (await context.request.get("http://localhost:4100/api/auth/me")).status(),
    ).toBe(401);
  } finally {
    await clearTestEmails(email);
  }
});

test("real login throttling returns 429 without losing input or signing in", async ({
  page,
  context,
}, testInfo) => {
  const email = `rate-${randomUUID()}@example.invalid`;
  for (let index = 0; index < 10; index++)
    expect(
      (
        await context.request.post("http://localhost:4100/api/auth/login", {
          headers: { Origin: "http://localhost:3100" },
          data: { email },
        })
      ).status(),
    ).toBe(400);
  await page.goto("/login");
  const form = page.getByRole("form", { name: "Sign in", exact: true });
  await form.getByLabel("Email address").fill(email);
  await form.getByLabel(/^Password/).fill("synthetic-wrong-password");
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/auth/login") &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(429);
  expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
  await expect(form.getByText(/You can try again in/)).toBeVisible();
  await expect(
    form.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
  await expect(form.getByLabel("Email address")).toHaveValue(email);
  await expect(form.getByLabel(/^Password/)).toHaveValue(
    "synthetic-wrong-password",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("login-rate-limited.png"),
    fullPage: true,
  });
  await expect(page).toHaveURL("/login");
  expect(
    (await context.request.get("http://localhost:4100/api/auth/me")).status(),
  ).toBe(401);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});

test("registration, resend and activation honor 429 wait without automatic resubmission", async ({
  page,
}) => {
  await page.clock.install();
  for (const action of ["register", "resend-verification", "verify-email"]) {
    await page.goto(
      "/" +
        action +
        (action === "verify-email" ? "#token=" + "a".repeat(43) : ""),
    );
    let requests = 0;
    await page.route("**/auth/" + action, (route) => {
      requests++;
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "http://localhost:3100",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Expose-Headers": "Retry-After",
          "Retry-After": "2",
        },
        body: JSON.stringify({
          code: "RATE_LIMITED",
          message: "Too many attempts. Try again later.",
          retryAfterSeconds: 60,
        }),
      });
    });
    if (action !== "verify-email")
      await page
        .getByLabel("Email address")
        .fill("synthetic-rate@example.invalid");
    if (action === "register") {
      await page.getByLabel(/^Password/).fill("synthetic-valid-password");
      await page
        .getByLabel(/^Confirm password/)
        .fill("synthetic-valid-password");
      await page.getByLabel("I declare that I am 18 or older").check();
    }
    const button = page.getByRole("button", {
      name:
        action === "register"
          ? "Create account"
          : action === "verify-email"
            ? "Verify email"
            : "Request activation email",
      exact: true,
    });
    await button.click();
    await expect(
      page.getByText("You can try again in 2 seconds.", { exact: true }),
    ).toBeVisible();
    await expect(button).toBeDisabled();
    await page.clock.fastForward(2100);
    await expect(button).toBeEnabled();
    expect(requests).toBe(1);
    if (action !== "verify-email")
      await expect(page.getByLabel("Email address")).toHaveValue(
        "synthetic-rate@example.invalid",
      );
    await page.unroute("**/auth/" + action);
  }
});
