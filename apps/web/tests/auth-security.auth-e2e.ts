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
