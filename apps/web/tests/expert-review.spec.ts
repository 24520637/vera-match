import { expect, test } from "@playwright/test";

const fixture = "http://127.0.0.1:3101/expert-review";

test("summary autosave preserves existing observations when verified duration is unavailable", async ({ page }) => {
  let draft = { id: "legacy-draft", version: 1, summary: null as string | null, limitations: null,
    observations: [{ category: "EYE", startMs: 0, endMs: 100, observation: "Turns left.", context: null }] };
  let savedBody: unknown;
  await page.route("**/api/**", async route => {
    const request = route.request();
    if (request.url().endsWith("/auth/me"))
      return route.fulfill({ json: { id: "expert-one", role: "EXPERT", email: "expert@example.invalid", displayName: null } });
    if (request.method() === "PATCH") {
      savedBody = request.postDataJSON();
      draft = { ...draft, summary: "Updated summary", version: 2 };
    }
    return route.fulfill({ json: { draft, durationMs: null } });
  });
  await page.goto(fixture);
  await expect(page.getByRole("button", { name: "Add observation" })).toBeDisabled();
  await page.getByLabel("Summary").fill("Updated summary");
  await expect(page.getByText("Saved version 2")).toBeVisible();
  expect(savedBody).toEqual({ expectedVersion: 1, summary: "Updated summary", limitations: null });
  await expect(page.getByLabel("Observable evidence")).toHaveValue("Turns left.");
});

test("private workspace reloads the draft and never overwrites a stale version", async ({ page }) => {
  let draft = { id: "review-one", version: 1, summary: null as string | null, limitations: null, observations: [] };
  let stale = false, writes = 0;
  await page.route("**/api/**", async route => {
    const request = route.request();
    if (request.url().endsWith("/auth/me"))
      return route.fulfill({ json: { id: "expert-one", role: "EXPERT", email: "expert@example.invalid", displayName: null } });
    if (request.method() === "PATCH") {
      writes++;
      const body = request.postDataJSON();
      expect(body.expectedVersion).toBe(draft.version);
      if (stale) return route.fulfill({ status: 409, json: { code: "REVIEW_VERSION_CONFLICT" } });
      draft = { ...draft, summary: body.summary, version: draft.version + 1 };
    }
    return route.fulfill({ json: { draft, durationMs: 10000 } });
  });
  await page.goto(fixture);
  await page.getByLabel("Summary").fill("Synthetic persisted summary");
  await expect(page.getByText("Saved version 2")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Summary")).toHaveValue("Synthetic persisted summary");
  stale = true;
  await page.getByLabel("Summary").fill("Stale edit");
  await expect(page.getByText("This draft changed elsewhere. Reload the saved draft to continue.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry save" })).toBeDisabled();
  expect(writes).toBe(2);
  await page.getByRole("button", { name: "Reload saved draft" }).click();
  await expect(page.getByLabel("Summary")).toHaveValue("Synthetic persisted summary");
});

test("a denied assignment exposes neither editor nor player and never requests playback", async ({ page }) => {
  const calls: string[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path === "/api/auth/me")
      return route.fulfill({ json: { id: "foreign-expert", role: "EXPERT", email: "expert@example.invalid", displayName: null } });
    return route.fulfill({ status: 404, json: { message: "Synthetic provider payload must stay hidden" } });
  });
  await page.goto(fixture);
  await expect(page.getByText("Review access could not be confirmed. Check your session and assignment.")).toBeVisible();
  await expect(page.getByLabel("Summary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load playback" })).toHaveCount(0);
  await expect(page.getByText("Synthetic provider payload must stay hidden")).toHaveCount(0);
  expect(calls).not.toContain("/api/expert/assignments/synthetic-assignment/playback");
});

test("authorized playback uses the assigned endpoint and exposes timeline markers", async ({ page }) => {
  let calls = 0;
  const videoUrl = "http://127.0.0.1:3101/test-private-video.mp4";
  await page.route(videoUrl, async route => route.fulfill({ status: 200, contentType: "video/mp4", body: "" }));
  await page.route("**/api/**", async route => {
    const request = route.request();
    if (request.url().endsWith("/auth/me"))
      return route.fulfill({ json: { id: "expert-one", role: "EXPERT", email: "expert@example.invalid", displayName: null } });
    if (request.url().endsWith("/playback")) {
      calls++;
      expect(new URL(request.url()).pathname).toBe("/api/expert/assignments/synthetic-assignment/playback");
      expect(request.postDataJSON()).toEqual({});
      return route.fulfill({ json: { url: videoUrl, expiresAt: new Date(Date.now() + 60000).toISOString() } });
    }
    return route.fulfill({ json: { durationMs: 10000, draft: { id: "draft-one", version: 1, summary: null,
      limitations: null, observations: [{ category: "BODY", startMs: 200, endMs: 300, observation: "Raises hand.", context: "After the question." }] } } });
  });
  await page.goto(fixture);
  await expect(page.getByLabel("Start (ms)")).toHaveValue("200");
  await expect(page.getByLabel("Category")).toHaveValue("BODY");
  await expect(page.getByRole("button", { name: "Jump to start" })).toBeDisabled();
  await page.getByRole("button", { name: "Load playback" }).click();
  await expect.poll(() => calls).toBe(1);
});
