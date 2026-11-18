import { expect, test, type Page } from "@playwright/test";

const url = "http://127.0.0.1:3101/expert-queues?mode=live";
async function setup(page: Page, role = "EXPERT") {
  const auth = { id: "actor-a", role, unavailable: false };
  const calls: { body: unknown; key: string | undefined }[] = [];
  const server = { failPost: false, queueStatus: 200, queueRows: [{ id: "own-job", status: "ASSIGNED", dueAt: null }], postGate: undefined as Promise<void> | undefined };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill(auth.unavailable ? { status: 503, json: {} } : { json: { id: auth.id, role: auth.role, displayName: null, email: "synthetic@example.invalid" } });
    if (path.endsWith("/candidate")) {
      const query = new URL(request.url()).searchParams;
      return route.fulfill({ json: { candidate: { videoId: query.get("videoId"), expertId: query.get("expertId"), expectedCredentialRevision: 7 } } });
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON(); calls.push({ body, key: request.headers()["idempotency-key"] });
      if (server.postGate) await server.postGate;
      if (server.failPost) return route.abort("failed");
      return route.fulfill({ status: 201, json: { assignment: { ...body, id: "created-job", credentialApprovalId: "synthetic-approval", revision: 0, status: "ASSIGNED" } } });
    }
    return route.fulfill({ status: server.queueStatus, json: server.queueStatus === 200 ? { assignments: server.queueRows, nextCursor: null } : { code: "ASSIGNMENT_ASSURANCE_UNAVAILABLE" } });
  });
  return { auth, calls, server };
}
async function prepare(page: Page, video = "known-video", expert = "known-expert") {
  await page.getByLabel("Video reference", { exact: true }).fill(video);
  await page.getByLabel("Expert reference", { exact: true }).fill(expert);
  await page.getByRole("button", { name: "Check candidate pair" }).click();
  await expect(page.getByText("Candidate pair verified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review assignment" }).click();
}
test("real queue path renders the API response rather than fixture-only pagination DTOs", async ({ page }) => {
  await setup(page); await page.goto(url);
  await expect(page.getByRole("heading", { name: "Assignment own-job" })).toBeVisible();
  await expect(page.getByText("Assignment queue is not connected", { exact: true })).toHaveCount(0);
});
test("moderator confirms the server checked pair using the exact C033 body", async ({ page }) => {
  const { calls } = await setup(page, "MODERATOR"); await page.goto(url + "&role=moderator"); await prepare(page);
  await expect(page.getByRole("button", { name: "Confirm assignment", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm assignment", exact: true }).click();
  await expect(page.getByText("Creation receipt confirmed", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toEqual({ videoId: "known-video", expertId: "known-expert", expectedCredentialRevision: 7, dueAt: null, expiresAt: null });
  expect(calls[0].key).toBeTruthy();
});
test("uncertain POST keeps the original operation across session failure and manual retry", async ({ page }) => {
  const { auth, calls, server } = await setup(page, "MODERATOR"); server.failPost = true;
  await page.goto(url + "&role=moderator"); await prepare(page); await page.getByRole("button", { name: "Confirm assignment", exact: true }).click();
  await expect(page.getByText("Assignment not confirmed", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  auth.unavailable = true; await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Original assignment request retained", { exact: true })).toHaveCount(0);
  auth.unavailable = false; await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Original assignment request retained", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  server.failPost = false; await page.getByRole("button", { name: "Retry original request" }).click();
  await expect(page.getByText("Creation receipt confirmed", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
});
test("ADMIN never sees moderator creation controls", async ({ page }) => {
  await setup(page, "ADMIN"); await page.goto(url + "&role=moderator");
  await expect(page.getByText("Assignment access denied", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check candidate pair" })).toHaveCount(0);
});
test("unavailable moderator assurance is explicit and never appears as a successful empty queue", async ({ page }) => {
  const { server } = await setup(page, "MODERATOR"); server.queueStatus = 503;
  await page.goto(url + "&role=moderator");
  await expect(page.getByText("Assignment queue unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("The service could not confirm access or availability. Retry later.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assignment own-job" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No assignments in this queue" })).toHaveCount(0);
});

test("a moderator with no authorized assignments sees the confirmed empty state", async ({ page }) => {
  const { server } = await setup(page, "MODERATOR"); server.queueRows = [];
  await page.goto(url + "&role=moderator");
  await expect(page.getByRole("heading", { name: "No assignments in this queue" })).toBeVisible();
  await expect(page.getByText("Assignment queue unavailable", { exact: true })).toHaveCount(0);
});
test("pending operations are hidden from another account and restored only to the original moderator", async ({ page }) => {
  const { auth, calls, server } = await setup(page, "MODERATOR"); server.failPost = true;
  await page.goto(url + "&role=moderator"); await prepare(page);
  await page.getByRole("button", { name: "Confirm assignment", exact: true }).click();
  await expect(page.getByText("Assignment not confirmed", { exact: true })).toBeVisible();
  auth.id = "actor-b"; await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByLabel("Video reference", { exact: true })).toHaveValue("");
  await expect(page.getByText("Original assignment request retained", { exact: true })).toHaveCount(0);
  auth.id = "actor-a"; await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Original assignment request retained", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
});
test("rapid duplicate confirmation cannot send a second mutation", async ({ page }) => {
  const { calls, server } = await setup(page, "MODERATOR");
  let release!: () => void; server.postGate = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.goto(url + "&role=moderator"); await prepare(page);
    await page.getByRole("button", { name: "Confirm assignment", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => calls.length).toBe(1);
    await expect(page.getByRole("button", { name: "Retry original request" })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByText("Creation receipt confirmed", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
});
test("a late failed request cannot replace a newer pending operation after reconciliation", async ({ page }) => {
  const { auth, calls, server } = await setup(page, "MODERATOR");
  let release!: () => void; server.postGate = new Promise<void>(resolve => { release = resolve; });
  async function sessionCycle() {
    auth.unavailable = true; await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("heading", { name: "Create an assignment" })).toHaveCount(0);
    auth.unavailable = false; await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("heading", { name: "Create an assignment" })).toBeVisible();
  }
  try {
    await page.goto(url + "&role=moderator"); await prepare(page);
    await page.getByRole("button", { name: "Confirm assignment", exact: true }).click();
    await expect.poll(() => calls.length).toBe(1);
    await sessionCycle();
    server.postGate = undefined;
    await page.getByRole("button", { name: "Retry original request" }).click();
    await expect(page.getByText("Creation receipt confirmed", { exact: true })).toBeVisible();
    server.failPost = true;
    await prepare(page, "new-video", "new-expert");
    await page.getByRole("button", { name: "Confirm assignment", exact: true }).click();
    await expect(page.getByText("Assignment not confirmed", { exact: true })).toBeVisible();
    const failed = page.waitForEvent("requestfailed", { predicate: request => request.method() === "POST" });
    release(); await failed;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await sessionCycle();
    await expect(page.getByText("Video reference: new-video. Expert reference: new-expert.", { exact: true })).toBeVisible();
    expect(calls).toHaveLength(3);
  } finally { release(); }
});
