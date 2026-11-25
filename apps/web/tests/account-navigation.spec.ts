import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const fixture = "http://127.0.0.1:3101/account-overview";
const cases = [
  { role: "MEMBER", label: "Your profile", href: "/account/profile" },
  { role: "EXPERT", label: "My assignments", href: "/expert/assignments" },
  { role: "MODERATOR", label: "Video assignments", href: "/moderation/assignments" },
  { role: "ADMIN", label: "API documentation", href: "/api/docs" },
];

for (const entry of cases) {
  test(`${entry.role} can find their workspace from the account and navigation`, async ({ page }) => {
    await page.route("**/api/auth/me", route => route.fulfill({ json: {
      id: "synthetic-staff", email: "demo@example.invalid", displayName: "Demo", role: entry.role,
    } }));
    await page.goto(fixture);
    const main = page.locator("main");
    await expect(main.getByRole("link", { name: entry.label, exact: true })).toHaveAttribute("href", entry.href);
    await expect(main.getByText(/still in development/)).toHaveCount(0);
    if (entry.role === "MEMBER") {
      await expect(main.getByRole("link", { name: "Discover people" })).toHaveAttribute("href", "/account/matches");
      await main.getByText("Preferences, privacy & more", { exact: true }).click();
      await expect(main.getByRole("navigation", { name: "Member settings" })).toBeVisible();
      await expect(main.getByRole("navigation", { name: "Staff tools" })).toHaveCount(0);
    } else {
      await expect(main.getByRole("navigation", { name: "Member settings" })).toHaveCount(0);
      await expect(main.getByRole("link", { name: "Staff security", exact: true })).toHaveAttribute("href", "/staff-security");
      const menu = page.getByRole("button", { name: "Menu", exact: true });
      if (await menu.isVisible()) await menu.click();
      const navigation = page.getByRole("navigation", { name: "Main navigation" });
      await expect(navigation.getByRole("link", { name: entry.label, exact: true })).toHaveAttribute("href", entry.href);
      if (entry.role === "MODERATOR") {
        await expect(navigation.getByRole("link", { name: "Report queue" })).toHaveAttribute("href", "/moderation/reports");
        await expect(main.getByRole("link", { name: "Review QA" })).toHaveAttribute("href", "/qa/reviews");
      }
      for (const other of cases.filter(other => other.role !== entry.role && other.role !== "MEMBER")) {
        await expect(main.getByRole("link", { name: other.label, exact: true })).toHaveCount(0);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  });
}

test("a lost session removes staff account actions", async ({ page }) => {
  let signedIn = true;
  await page.route("**/api/auth/me", route => route.fulfill(signedIn ? { json: {
    id: "synthetic-expert", email: "demo@example.invalid", displayName: null, role: "EXPERT",
  } } : { status: 401, json: { code: "UNAUTHENTICATED" } }));
  await page.goto(fixture);
  await expect(page.locator("main").getByRole("link", { name: "My assignments" })).toBeVisible();
  signedIn = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("link", { name: "My assignments" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Staff tools" })).toHaveCount(0);
});
