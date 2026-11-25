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

for (const variant of [
  { button: "Accept", choice: "ACCEPT", historyLabel: "Accepted", receipt: { choice: "ACCEPT", mutual: "false" } },
  { button: "Decline", choice: "DECLINE", historyLabel: "Declined", receipt: { choice: "DECLINE", mutual: true } },
] as const) {
  test(`a malformed ${variant.choice} receipt requires checking history`, async ({ page }) => {
    await page.route("**/api/auth/me", route => route.fulfill({
      json: { id: "synthetic-member", role: "MEMBER", email: "member@example.invalid", displayName: null },
    }));
    await page.route("**/api/matches/recommendations", route => route.fulfill({ json: valid.recommendations }));
    let writes = 0;
    await page.route("**/api/matches/decisions", route => route.fulfill({
      json: {
        decisions: writes === 0 ? [] : [{ ...valid.decisions.decisions[0], choice: variant.choice, mutual: false }],
        nextCursor: null,
      },
    }));
    await page.route("**/api/matches/*/decision", route => {
      writes++;
      expect(route.request().postDataJSON()).toEqual({ choice: variant.choice });
      return route.fulfill({ json: variant.receipt });
    });

    await page.goto("http://127.0.0.1:3101/matches");
    const history = page.getByRole("region", { name: "Decision history" });
    await expect(history.getByText("No decisions on this page")).toBeVisible();
    await page.getByRole("button", { name: variant.button, exact: true }).press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "Your choice could not be confirmed. Check decision history" }))
      .toBeVisible();
    await expect(page.getByText(/^(Acceptance|Decline) saved\.$/)).toHaveCount(0);
    await expect(history).toContainText(variant.historyLabel);
    expect(writes).toBe(1);
  });
}

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

test("dating views keep discovery separate from connection activity without exposing a peer", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    id: "synthetic-member", role: "MEMBER", email: "member@example.invalid", displayName: null,
  } }));
  await page.route("**/api/matches/recommendations", route => route.fulfill({ json: valid.recommendations }));
  await page.route("**/api/matches/decisions", route => route.fulfill({ json: valid.decisions }));
  await page.goto("http://127.0.0.1:3101/matches");
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await expect(page.getByRole("region", { name: "Recommendations" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Decision history" })).toHaveCount(0);
  await expect(page.locator(".dating-introduction img")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("dating-discover.png"), fullPage: true });
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("region", { name: "Recommendations" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your connections" })).toBeVisible();
});
