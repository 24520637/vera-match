import { expect, test } from "@playwright/test";

const valid = {
  recommendations: {
    available: true, recommendations: [{ key: "candidate-key", pairId: "candidate-reference",
      reasons: ["Meets both members’ matching settings."] }], nextCursor: null,
  },
  decisions: {
    decisions: [{ id: "decision-key", choice: "ACCEPT", createdAt: "2026-11-21T00:00:00.000Z",
      available: true, mutual: true }], nextCursor: null,
  },
};

test("continues discovery from an empty page and stops at the end", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({
    json: { id: "synthetic-member", role: "MEMBER", email: "member@example.invalid", displayName: null },
  }));
  await page.route("**/api/matches/decisions", route => route.fulfill({ json: valid.decisions }));
  await page.route("**/api/matches/recommendations*", route => {
    const after = new URL(route.request().url()).searchParams.get("after");
    return route.fulfill({ json: after === "opaque-window" ? valid.recommendations : {
      available: true, recommendations: [], nextCursor: "opaque-window",
    } });
  });

  await page.goto("http://127.0.0.1:3101/matches");
  const section = page.getByRole("region", { name: "Recommendations" });
  const next = section.getByRole("button", { name: "Next recommendations" });
  await expect(section.getByText("No recommendations on this page")).toBeVisible();
  await next.click();
  await expect(section.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
  await expect(next).toHaveCount(0);
});

for (const endpoint of ["recommendations", "decisions"] as const) {
  for (const variant of ["null", "invalid item"] as const) {
    test(`${endpoint} rejects a successful ${variant} response and supports retry`, async ({ page }) => {
      const heading = endpoint === "recommendations" ? "Recommendations" : "Decision history";
      const previous = endpoint === "recommendations" ? "Meets both members’ matching settings." : "Mutual match";
      const retry = endpoint === "recommendations" ? "Refresh recommendations" : "Refresh decision history";
      const malformed = variant === "null" ? null : endpoint === "recommendations" ? {
        ...valid.recommendations, recommendations: [
          { key: "other-key", pairId: "other-reference", reasons: ["SYNTHETIC PRIVATE FIELD"] },
          { key: "broken" },
        ],
      } : { ...valid.decisions, decisions: [...valid.decisions.decisions, { id: "broken", choice: "unknown" }] };
      let invalid = false;
      const pageErrors: Error[] = [];
      page.on("pageerror", error => pageErrors.push(error));
      await page.route("**/api/auth/me", route => route.fulfill({
        json: { id: "synthetic-member", role: "MEMBER", email: "member@example.invalid", displayName: null },
      }));
      for (const path of ["recommendations", "decisions"] as const) {
        await page.route(`**/api/matches/${path}`, route => route.fulfill({
          body: JSON.stringify(invalid && path === endpoint ? malformed : valid[path]),
          contentType: "application/json",
        }));
      }
      await page.goto("http://127.0.0.1:3101/matches");
      const section = page.getByRole("region", { name: heading });
      await expect(section.getByText(previous)).toBeVisible();

      invalid = true;
      await page.getByRole("button", { name: "Refresh matches", exact: true }).click();
      await expect(section.getByRole("alert")).toContainText("Matching could not be loaded. Try again.");
      await expect(section.getByText(previous)).toHaveCount(0);
      await expect(section.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
      await expect(page.getByText("SYNTHETIC PRIVATE FIELD")).toHaveCount(0);

      invalid = false;
      await section.getByRole("button", { name: retry }).click();
      await expect(section.getByText(previous)).toBeVisible();
      expect(pageErrors).toEqual([]);
    });
  }
}
