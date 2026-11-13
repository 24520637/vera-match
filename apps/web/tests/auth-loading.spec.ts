import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const fixtureUrl = "http://127.0.0.1:3101";

test("protected layout server rendering defaults to pending without child markup", async ({ request, browser }) => {
  const response = await request.get(`${fixtureUrl}/protected`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("Checking your session");
  expect(html).not.toContain("Synthetic protected content");

  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${fixtureUrl}/protected`);
    await expect(page.getByRole("region", { name: "Session access" })).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status")).toContainText("Checking your session");
    await expect(page.getByTestId("protected-content")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("hydration keeps protected content absent until explicit readiness", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat|did not match/i.test(message.text()))
      errors.push(message.text());
  });
  await page.addInitScript(() => {
    const observed = window as Window & { protectedFlashes?: number };
    observed.protectedFlashes = 0;
    new MutationObserver(() => {
      const harness = document.querySelector('[data-testid="state-harness"]');
      if (document.querySelector('[data-testid="protected-content"]') &&
          harness?.getAttribute("data-state") !== "authenticated") {
        observed.protectedFlashes = (observed.protectedFlashes ?? 0) + 1;
      }
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
  await page.goto(fixtureUrl);
  await expect(page.getByTestId("hydration")).toHaveText("Hydrated");
  await expect(page.getByTestId("protected-content")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Checking your session");
  await page.getByRole("button", { name: "Show authenticated", exact: true }).click();
  await expect(page.getByTestId("protected-content")).toBeVisible();
  await page.getByRole("button", { name: "Show pending", exact: true }).click();
  await expect(page.getByTestId("protected-content")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { protectedFlashes?: number }).protectedFlashes)).toBe(0);
  expect(errors).toEqual([]);

  await page.goto(`${fixtureUrl}/protected`);
  await expect(page.getByRole("status")).toContainText("Checking your session");
  await expect(page.getByTestId("protected-content")).toHaveCount(0);
});

test("all non-authenticated transitions withhold children and error retry returns to pending", async ({ page }) => {
  const authRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/auth")) authRequests.push(request.url());
  });
  await page.goto(fixtureUrl);
  const region = page.getByRole("region", { name: "Session access" });
  for (const state of ["pending", "unauthenticated", "forbidden", "error"]) {
    await page.getByRole("button", { name: "Show authenticated", exact: true }).click();
    await expect(page.getByTestId("protected-content")).toBeVisible();
    await page.getByRole("button", { name: `Show ${state}`, exact: true }).click();
    await expect(page.getByTestId("protected-content")).toHaveCount(0);
    await expect(region).toHaveAttribute("aria-busy", String(state === "pending"));
    if (state === "unauthenticated") await expect(region).toContainText("Sign-in is required.");
    if (state === "forbidden") await expect(region).toContainText("does not have permission");
  }
  await expect(region.getByRole("alert")).toContainText("does not mean you are signed out");
  const retry = region.getByRole("button", { name: "Try again" });
  await retry.focus();
  await expect(retry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("retry-count")).toHaveText("Retry count: 1");
  await expect(region.getByRole("status")).toContainText("Checking your session");
  await expect(region).toHaveAttribute("aria-busy", "true");
  await expect(region.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(page.getByTestId("protected-content")).toHaveCount(0);
  expect(authRequests).toEqual([]);
});

test("session feedback is accessible and wraps at mobile widths", async ({ page }) => {
  await page.goto(fixtureUrl);
  for (const state of ["pending", "unauthenticated", "forbidden", "error", "authenticated"]) {
    await page.getByRole("button", { name: `Show ${state}`, exact: true }).click();
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});
