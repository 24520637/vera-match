import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const fixture = "http://127.0.0.1:3101/expert-queues";
const row = (id: string, status = "ASSIGNED", dueAt: string | null = null) => ({ id, status, dueAt });
async function setup(page: Page, role = "EXPERT") {
  const auth = { id: "synthetic-expert-a", role, unavailable: false };
  const queue = { items: [row("job-a")], nextCursor: null as string | null, status: 200, calls: 0 };
  await page.route("**/api/auth/me", route => route.fulfill(auth.unavailable ? { status: 503, json: {} } :
    { json: { id: auth.id, email: "synthetic@example.invalid", displayName: null, role: auth.role } }));
  await page.route("**/api/__test__/expert-queue*", route => {
    queue.calls++;
    return route.fulfill({ status: queue.status, headers: queue.status === 429 ? { "Retry-After": "1" } : {},
      json: queue.status === 200 ? { items: queue.items, nextCursor: queue.nextCursor } : { message: "private server detail" } });
  });
  return { auth, queue };
}
test("unconnected presentation is explicit, never a fabricated empty queue or stale contract claim", async ({ page }) => {
  const { queue } = await setup(page);
  await page.goto(fixture + "?mode=unconnected");
  await expect(page.getByText("Assignment queue unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/No server-backed queue adapter is configured for this view/)).toBeVisible();
  await expect(page.getByText(/contracts are not implemented yet/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load assignments", exact: true })).toBeDisabled();
  await expect(page.getByText("No assignments in this queue", { exact: true })).toHaveCount(0);
  expect(queue.calls).toBe(0);
});
test("renders assignment status and UTC deadline without video actions", async ({ page }) => {
  const { queue } = await setup(page);
  queue.items = [row("job-a", "IN_PROGRESS", "2026-11-18T12:00:00.000Z"), row("job-b")];
  await page.goto(fixture);
  await expect(page.getByText("In progress", { exact: true })).toBeVisible();
  await expect(page.getByText("Due: No deadline set", { exact: true })).toBeVisible();
  await expect(page.locator("time")).toHaveAttribute("datetime", "2026-11-18T12:00:00.000Z");
  await expect(page.getByRole("button", { name: /play|cancel|submit/i })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("empty state is shown only after an authorized loader returns no rows", async ({ page }) => {
  const { queue } = await setup(page); queue.items = [];
  await page.goto(fixture);
  await expect(page.getByRole("heading", { name: "No assignments in this queue" })).toBeVisible();
});
test("moderator queue reuses the same foundation", async ({ page }) => {
  await setup(page, "MODERATOR"); await page.goto(fixture + "?role=moderator");
  await expect(page.getByRole("heading", { name: "Assignment moderation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assignment job-a" })).toBeVisible();
});
for (const role of ["ADMIN", "MEMBER", "MODERATOR"]) test(`${role} cannot load the expert queue`, async ({ page }) => {
  const { queue } = await setup(page, role); await page.goto(fixture);
  await expect(page.getByText("Assignment access denied", { exact: true })).toBeVisible();
  expect(queue.calls).toBe(0);
});
for (const status of [401, 403, 503]) test(`HTTP ${status} hides rows and shows a recovery state`, async ({ page }) => {
  const { queue } = await setup(page); await page.goto(fixture);
  await expect(page.getByRole("heading", { name: "Assignment job-a" })).toBeVisible();
  queue.status = status; await page.getByRole("button", { name: "Refresh assignments" }).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assignment job-a" })).toHaveCount(0);
  await expect(page.getByText("private server detail", { exact: true })).toHaveCount(0);
});
test("pagination appends without duplicates and restores useful focus", async ({ page }) => {
  const { queue } = await setup(page); queue.nextCursor = "synthetic-page-2";
  await page.goto(fixture);
  await expect(page.getByRole("heading", { name: "Assignment job-a" })).toBeVisible();
  queue.items = [row("job-a"), row("job-b", "SUBMITTED")]; queue.nextCursor = null;
  await page.getByRole("button", { name: "Load more assignments" }).click();
  await expect(page.getByRole("heading", { name: "Assignment job-a" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Assignment job-b" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assignment queue", exact: true })).toBeFocused();
});
test("account switch hides old rows and ignores the old account's delayed response", async ({ page }) => {
  const { auth } = await setup(page);
  let release!: () => void, started!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/api/__test__/expert-queue*", async route => {
    // Strict Mode may start more than one request for A. Hold every A response,
    // not just the first network request, until B has actually mounted.
    if (auth.id === "synthetic-expert-a") { started(); await barrier; await route.fulfill({ json: { items: [row("old-private-job")], nextCursor: null } }).catch(() => {}); }
    else await route.fulfill({ json: { items: [row("new-account-job")], nextCursor: null } });
  });
  try {
    await page.goto(fixture); await ready;
    await expect(page.getByText("Loading assignments…", { exact: true })).toBeVisible();
    auth.id = "synthetic-expert-b";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("heading", { name: "Assignment new-account-job" })).toBeVisible();
  } finally { release(); }
  await expect(page.getByText("old-private-job", { exact: false })).toHaveCount(0);
});
test("temporary session failure hides private rows", async ({ page }) => {
  const { auth } = await setup(page); await page.goto(fixture);
  await expect(page.getByRole("heading", { name: "Assignment job-a" })).toBeVisible();
  auth.unavailable = true; await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("heading", { name: "Assignment job-a" })).toHaveCount(0);
});
test("429 countdown only enables manual retry", async ({ page }) => {
  const { queue } = await setup(page); queue.status = 429; await page.goto(fixture);
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  const calls = queue.calls;
  await expect(page.getByRole("button", { name: "Refresh assignments" })).toBeEnabled();
  expect(queue.calls).toBe(calls);
  queue.status = 200; await page.getByRole("button", { name: "Refresh assignments" }).click();
  await expect(page.getByRole("heading", { name: "Assignment job-a" })).toBeVisible();
});
test("confirmation cannot submit and restores keyboard focus", async ({ page }) => {
  await setup(page); const mutations: string[] = [];
  page.on("request", request => { if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) mutations.push(request.url()); });
  await page.goto(fixture + "?mode=unconnected");
  await page.getByRole("button", { name: "Preview confirmation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm assignment", exact: true })).toBeDisabled();
  await expect(page.getByText("synthetic-video-reference", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to queue" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Preview confirmation" })).toBeFocused();
  expect(mutations).toEqual([]);
});
