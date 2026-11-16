import { expect, Page, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { defaults, purposes, purposeLabels, questions } from "../src/lib/member-contracts";

const url = "http://127.0.0.1:3101/member-settings";
type Failure = { status: number; body: object; headers?: Record<string, string> };
async function mock(page: Page) {
  const state = {
    profile: { revision: 0, profile: null as Record<string, unknown> | null },
    preferences: { revision: 0, preferences: null as Record<string, unknown> | null },
    questionnaire: { revision: 0, questionnaire: { questionnaireVersion: 1, answers: [] as object[] } },
    consents: { version: 0, consents: purposes.map(purpose => ({ purpose, granted: false, policyVersion: null as string | null,
      grantedAt: null, revokedAt: null, updatedAt: null })) },
  };
  const calls: { path: string; method: string; body: Record<string, unknown>; key?: string }[] = [];
  const failures: Record<string, Failure | undefined> = {};
  const replay = new Map<string, object>();
  let dropConsent = false;
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
    if (path === "/api/auth/me") return route.fulfill({ json: { id: "synthetic-member", email: "member@example.invalid", displayName: null, role: "MEMBER" } });
    const resource = path.split("/")[2] as keyof typeof state;
    if (!(resource in state)) return route.fulfill({ status: 404, json: {} });
    const failure = failures[`${method}:${resource}`];
    const body = method === "GET" ? {} : req.postDataJSON() as Record<string, unknown>;
    if (method !== "GET") calls.push({ path, method, body, key: req.headers()["idempotency-key"] });
    if (failure) { if (method !== "GET") delete failures[`${method}:${resource}`]; return route.fulfill({ status: failure.status, json: failure.body, headers: failure.headers }); }
    if (method === "GET") return route.fulfill({ json: state[resource] });
    if (resource === "consents") {
      const key = req.headers()["idempotency-key"];
      if (replay.has(key)) return route.fulfill({ json: replay.get(key), headers: { "Idempotency-Replayed": "true" } });
      if (body.expectedVersion !== state.consents.version) return route.fulfill({ status: 409, json: { code: "VERSION_CONFLICT" } });
      for (const item of body.consents as { purpose: string; granted: boolean; policyVersion?: string }[]) {
        const row = state.consents.consents.find(row => row.purpose === item.purpose)!;
        row.granted = item.granted; row.policyVersion = item.policyVersion ?? row.policyVersion;
      }
      state.consents.version++;
      replay.set(key, structuredClone(state.consents));
      if (dropConsent) { dropConsent = false; return route.abort("failed"); }
    } else {
      const target = state[resource];
      if (body.expectedRevision !== target.revision) return route.fulfill({ status: 409, json: { code: "RESOURCE_REVISION_CONFLICT" } });
      if (resource === "questionnaire") state.questionnaire.questionnaire = { questionnaireVersion: 1,
        answers: (body.answers as object[]).map(answer => ({ ...answer, updatedAt: "2026-11-16T00:00:00Z" })) };
      else {
        const { expectedRevision: _revision, ...fields } = body;
        if (resource === "profile") state.profile.profile = { ...defaults("profile"), ...state.profile.profile, ...fields };
        else state.preferences.preferences = { ...defaults("preferences"), ...state.preferences.preferences, ...fields };
      }
      target.revision++;
    }
    return route.fulfill({ json: state[resource] });
  });
  return { state, calls, failures, dropConsentResponse: () => { dropConsent = true; } };
}

test("profile save uses a dirty-field PATCH and reloads without enabling consent", async ({ page }) => {
  const server = await mock(page);
  await page.goto(`${url}?screen=profile`);
  await expect(page.getByText("Nothing saved yet", { exact: true })).toBeVisible();
  await page.getByLabel("City", { exact: true }).fill("Synthetic city");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Your changes were saved.")).toBeVisible();
  expect(server.calls[0].body).toEqual({ expectedRevision: 0, city: "Synthetic city" });
  await page.reload(); await expect(page.getByLabel("City", { exact: true })).toHaveValue("Synthetic city");
  expect(server.calls.filter(call => call.path.includes("consents"))).toHaveLength(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("409 keeps edits and requires refreshed data plus explicit review before resubmission", async ({ page }) => {
  const server = await mock(page);
  await page.goto(`${url}?screen=profile`);
  await expect(page.getByLabel("City", { exact: true })).toBeVisible();
  await page.getByLabel("City", { exact: true }).fill("My city");
  server.state.profile = { revision: 2, profile: { ...defaults("profile"), city: "Their city" } };
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Load latest version for review" }).click();
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("My city");
  await page.getByText("Latest saved values", { exact: true }).click();
  await expect(page.getByText("Their city", { exact: true })).toBeVisible();
  expect(server.calls).toHaveLength(1);
  await page.getByLabel("I reviewed the latest saved data and want to submit my edits.").check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Your changes were saved.")).toBeVisible();
  expect(server.calls[1].body).toEqual({ expectedRevision: 2, city: "My city" });
});
test("legacy 503 permits explicit correction without default-filled overwrites", async ({ page }) => {
  const server = await mock(page);
  server.state.profile.revision = 4;
  server.failures["GET:profile"] = { status: 503, body: { code: "DATA_SHAPE_UNAVAILABLE", revision: 4,
    message: "Stored profile data needs review.", details: [{ field: "interests", messages: ["Explicitly replace or clear this field."] }] } };
  await page.goto(`${url}?screen=profile`);
  await expect(page.getByText("Stored profile data needs review.")).toBeVisible();
  await page.getByRole("button", { name: "Empty interests", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Your changes were saved.")).toBeVisible();
  expect(server.calls[0].body).toEqual({ expectedRevision: 4, interests: [] });
  await expect(page.getByRole("link", { name: "Manage or withdraw consent" })).toBeVisible();
});
test("questionnaire submits all three answers and preferences preserve explicit priority order", async ({ page }) => {
  const server = await mock(page);
  await page.goto(`${url}?screen=questionnaire`);
  for (const q of questions) await page.getByLabel(q.prompt).fill(`Synthetic ${q.key}`);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Your changes were saved.")).toBeVisible();
  expect(server.calls[0]).toMatchObject({ method: "PUT", body: { expectedRevision: 0, questionnaireVersion: 1,
    answers: questions.map(q => ({ questionKey: q.key, responseText: `Synthetic ${q.key}` })) } });
  await page.goto(`${url}?screen=preferences`);
  await page.getByLabel("Minimum age").fill("18"); await page.getByLabel("Maximum age").fill("120");
  await page.getByRole("group", { name: "Priority order", exact: true }).getByLabel("interests", { exact: true }).check();
  await page.getByRole("group", { name: "Priority order", exact: true }).getByLabel("values", { exact: true }).check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Your changes were saved.")).toBeVisible();
  expect(server.calls[1].body).toEqual({ expectedRevision: 0, minAge: 18, maxAge: 120, priorities: ["interests", "values"] });
});
test("missing policy disables grants while all five withdrawals remain explicit and independent", async ({ page }) => {
  const server = await mock(page);
  await page.goto(`${url}?screen=consents`);
  for (const purpose of purposes) {
    await expect(page.getByRole("button", { name: `Grant ${purposeLabels[purpose].toLowerCase()}`, exact: true })).toBeDisabled();
  }
  await page.getByRole("button", { name: "Withdraw video storage", exact: true }).click();
  await expect(page.getByText("Request recorded. The current consent choices are shown below.")).toBeVisible();
  expect(server.calls[0].body).toEqual({ expectedVersion: 0, consents: [{ purpose: "VIDEO_STORAGE", granted: false }] });
  expect(server.calls[0].key).toMatch(/^[a-f0-9-]{36}$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("synthetic grant requires explicit agreement; uncertain result is reconciled only on user action with the original key", async ({ page }) => {
  const server = await mock(page);
  await page.goto(`${url}?screen=consents&policies=synthetic`);
  const button = page.getByRole("button", { name: "Grant profile matching", exact: true });
  await expect(button).toBeDisabled();
  await page.getByLabel("I agree to the displayed profile matching policy.").check();
  server.dropConsentResponse(); await button.click();
  await expect(page.getByRole("button", { name: "Reconcile original request" })).toBeVisible();
  expect(server.calls).toHaveLength(1); await expect(button).toBeDisabled();
  await page.getByRole("button", { name: "Reconcile original request" }).click();
  await expect(page.getByText("Request recorded. The current consent choices are shown below.")).toBeVisible();
  expect(server.calls).toHaveLength(2); expect(server.calls[1].key).toBe(server.calls[0].key);
  expect(server.calls[1].body).toEqual(server.calls[0].body);
  expect(server.state.consents.version).toBe(1);
});
test("grant 429 does not disable the independent withdrawal lane or imply success", async ({ page }) => {
  const server = await mock(page);
  await page.goto(`${url}?screen=consents&policies=synthetic`);
  await page.getByLabel("I agree to the displayed profile matching policy.").check();
  server.failures["PATCH:consents"] = { status: 429, body: { code: "RATE_LIMITED" }, headers: { "Retry-After": "60" } };
  await page.getByRole("button", { name: "Grant profile matching", exact: true }).click();
  await expect(page.getByText("Too many requests.", { exact: false })).toBeVisible();
  const withdraw = page.getByRole("button", { name: "Withdraw profile matching", exact: true });
  await expect(withdraw).toBeEnabled(); await withdraw.click();
  await expect(page.getByText("Request recorded. The current consent choices are shown below.")).toBeVisible();
  expect(server.calls[1].body).toEqual({ expectedVersion: 0, consents: [{ purpose: "PROFILE_MATCHING", granted: false }] });
});
test("consent 409 refreshes for review without automatically replaying a grant", async ({ page }) => {
  const server = await mock(page);
  await page.goto(`${url}?screen=consents&policies=synthetic`);
  await page.getByLabel("I agree to the displayed profile matching policy.").check();
  server.state.consents.version = 1;
  await page.getByRole("button", { name: "Grant profile matching", exact: true }).click();
  await expect(page.getByText("Refresh and review your current choices.", { exact: true })).toBeVisible();
  expect(server.calls).toHaveLength(1);
  await page.getByRole("button", { name: "Refresh current consents", exact: true }).click();
  await expect(page.getByRole("button", { name: "Grant profile matching", exact: true })).toBeDisabled();
  expect(server.calls).toHaveLength(1);
  await page.getByLabel("I agree to the displayed profile matching policy.").check();
  await page.getByRole("button", { name: "Grant profile matching", exact: true }).click();
  await expect(page.getByText("Request recorded. The current consent choices are shown below.")).toBeVisible();
  expect(server.calls[1].key).not.toBe(server.calls[0].key);
  expect(server.calls[1].body.expectedVersion).toBe(1);
});
test("400 errors stay beside the field and preserve the submitted age bounds", async ({ page }) => {
  const server = await mock(page);
  await page.goto(`${url}?screen=preferences`);
  await page.getByLabel("Minimum age").fill("40"); await page.getByLabel("Maximum age").fill("20");
  server.failures["PATCH:preferences"] = { status: 400, body: { code: "VALIDATION_FAILED", message: "Check the submitted fields.",
    details: [{ field: "maxAge", messages: ["Maximum age must be at least minimum age."] }] } };
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Maximum age")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Minimum age")).toHaveValue("40");
  await expect(page.getByLabel("Maximum age")).toHaveValue("20");
});
test("pending reads show loading rather than a default success", async ({ page }) => {
  await mock(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/profile/me", async route => { await gate; await route.fulfill({ json: { revision: 0, profile: null } }); });
  await page.goto(`${url}?screen=profile`);
  await expect(page.getByText("Loading your saved choices…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  release(); await expect(page.getByText("Nothing saved yet", { exact: true })).toBeVisible();
});
for (const status of [401, 403, 429, 503]) test(`preferences displays actionable ${status} without claiming an empty saved resource`, async ({ page }) => {
  const server = await mock(page);
  server.failures["GET:preferences"] = { status, body: { message: "Service unavailable" }, headers: status === 429 ? { "Retry-After": "1" } : undefined };
  await page.goto(`${url}?screen=preferences`);
  await expect(page.locator("#preferences-summary").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  await expect(page.getByText("Nothing saved yet", { exact: true })).toHaveCount(0);
  expect(server.calls).toHaveLength(0);
});
