import { expect, test } from "@playwright/test";

const fixture = process.env.VERA_REVIEW_FIXTURE_URL ?? "http://127.0.0.1:3101";
const approvalTime = "2026-01-02T10:00:00.000Z";
const statement = "The member said they enjoy reading.";

test("owner confirms, explicitly shares, withdraws and disputes an individual claim", async ({ page }) => {
  let claim = { id: "reading", statement, revision: 0, ownerConfirmed: false, shareApproved: false,
    revokedAt: null as string | null, evidence: { startMs: 100, endMs: 900, context: "Hobbies prompt.", transcript: "I enjoy reading." } };
  const actions: string[] = [];
  const feedback: { target: string; note: string; revision: number; updatedAt: string }[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: {
      id: "owner", role: "MEMBER", email: "owner@example.invalid", displayName: null,
    } });
    if (path === "/api/reviews/me") return route.fulfill({ json: { reports: [{
      id: "review", summary: "Reported hobbies.", limitations: "One recording.", approvedAt: approvalTime,
      reviewer: null, source: { videoId: "video", uploadedAt: approvalTime }, claims: [{ ...claim, feedback }], disputes: [],
    }], nextCursor: null } });
    if (path === "/api/reviews/claims/reading/feedback") {
      expect(request.method()).toBe("PATCH");
      expect(request.postDataJSON()).toEqual({ target: "TRANSCRIPT", note: "I was quoting my friend.", expectedRevision: 0 });
      feedback.push({ target: "TRANSCRIPT", note: "I was quoting my friend.", revision: 1, updatedAt: approvalTime });
      return route.fulfill({ json: { feedback: feedback[0] } });
    }
    if (path === "/api/reviews/claims/reading") {
      const { action, expectedRevision } = request.postDataJSON();
      expect(request.method()).toBe("PATCH");
      expect(expectedRevision).toBe(claim.revision);
      actions.push(action);
      claim = { ...claim, revision: claim.revision + 1, ownerConfirmed: true, shareApproved: action === "SHARE",
        revokedAt: action === "REVOKE" ? approvalTime : null };
      return route.fulfill({ json: { claim } });
    }
    expect(path).toBe("/api/reviews/review/disputes");
    expect(request.postDataJSON()).toEqual({ reason: "Please check the context.", claimId: "reading" });
    return route.fulfill({ status: 201, json: { dispute: { id: "dispute", claimId: "reading", status: "OPEN",
      reason: "Please check the context.", resolution: null, createdAt: approvalTime } } });
  });
  await page.goto(fixture + "/review-reports");
  await expect(page.getByText("I enjoy reading.")).toBeVisible();
  await page.getByText("Annotate this claim’s evidence").click();
  await page.getByLabel("Private feedback on the transcript").fill("I was quoting my friend.");
  await page.getByRole("button", { name: "Save transcript feedback" }).click();
  await expect(page.getByText("Transcript feedback saved.")).toBeVisible();
  await page.reload();
  await page.getByText("Annotate this claim’s evidence").click();
  await expect(page.getByLabel("Private feedback on the transcript")).toHaveValue("I was quoting my friend.");
  expect(actions).toEqual([]);
  await expect(page.getByRole("button", { name: "Share this claim for matching" })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm this claim" }).click();
  await expect(page.getByText("Confirmed · not shared")).toBeVisible();
  await page.getByRole("button", { name: "Share this claim for matching" }).click();
  await expect(page.getByText("Sharing approved for matching")).toBeVisible();
  await page.getByRole("button", { name: "Revoke this claim" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm revocation" }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  expect(actions).toEqual(["CONFIRM", "SHARE", "REVOKE"]);
  await page.getByLabel("Dispute concerns").selectOption("reading");
  await page.getByLabel("Why are you disputing this?").fill("Please check the context.");
  await page.getByRole("button", { name: "Submit dispute" }).click();
  await expect(page.getByText("Please check the context.")).toBeVisible();
});

test("a moderator loads the approved report before recording dispute intake and a response", async ({ page }) => {
  let dispute = { id: "case", claimId: null, status: "OPEN", createdAt: approvalTime, revision: 0,
    reason: "Please verify the context.", resolution: null as string | null };
  const report = { version: 3, summary: "The member discussed hobbies.", limitations: "One recording.", approvedAt: approvalTime };
  let releaseReport!: () => void;
  const reportReady = new Promise<void>(resolve => { releaseReport = resolve; });
  const decisions: unknown[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: {
      id: "moderator", role: "MODERATOR", email: "mod@example.invalid", displayName: null,
    } });
    if (path === "/api/qa/reviews") return route.fulfill({ json: { reviews: [], nextCursor: null } });
    if (path === "/api/qa/reviews/disputes") return route.fulfill({ json: {
      disputes: [{ id: dispute.id, status: dispute.status, reviewId: "review", createdAt: approvalTime }], nextCursor: null,
    } });
    expect(path).toBe("/api/qa/reviews/disputes/case");
    if (request.method() === "GET") {
      await reportReady;
      return route.fulfill({ json: { dispute, reviewId: "review", claim: null, report } });
    }
    expect(request.method()).toBe("PATCH");
    const decision = request.postDataJSON();
    decisions.push(decision);
    dispute = { ...dispute, status: decision.status, resolution: decision.resolution ?? null, revision: dispute.revision + 1 };
    return route.fulfill({ json: { dispute } });
  });
  await page.goto(fixture + "/review-qa");
  await expect(page.getByRole("heading", { name: "Review quality assurance" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.getByRole("button", { name: "Review disputes" }).click();
  await page.getByRole("button", { name: "Open dispute case" }).click();
  try {
    await expect(page.getByText("Loading disputes…")).toBeVisible();
    await expect(page.getByRole("button", { name: /Start review|Uphold dispute|Reject dispute/ })).toHaveCount(0);
    expect(decisions).toEqual([]);
  } finally {
    releaseReport();
  }
  await expect(page.getByRole("heading", { name: "Approved report" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByText(report.summary)).toBeVisible();
  await expect(page.getByText(report.limitations)).toBeVisible();
  await expect(page.getByText("Version 3, approved")).toBeVisible();
  await expect(page.getByText("Please verify the context.")).toBeVisible();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByRole("button", { name: "Uphold dispute" })).toBeDisabled();
  await page.getByLabel("Response to member").fill("The prompt was broader than the recorded context.");
  await page.getByRole("button", { name: "Uphold dispute" }).click();
  await expect(page.getByText("The prompt was broader than the recorded context.")).toBeVisible();
  expect(decisions).toEqual([
    { status: "IN_REVIEW", expectedRevision: 0 },
    { status: "RESOLVED", expectedRevision: 1, resolution: "The prompt was broader than the recorded context." },
  ]);
});

for (const [scenario, status] of [["denied access", 403], ["a missing case", 404], ["a missing report snapshot", 200]] as const) {
  test(`a report-wide dispute with ${scenario} has no decision controls`, async ({ page }) => {
    let mutations = 0;
    await page.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: {
        id: "moderator", role: "MODERATOR", email: "mod@example.invalid", displayName: null,
      } });
      if (path === "/api/qa/reviews") return route.fulfill({ json: { reviews: [], nextCursor: null } });
      const entry = { id: "case", status: "IN_REVIEW", reviewId: "review", createdAt: approvalTime };
      if (path === "/api/qa/reviews/disputes") return route.fulfill({ json: { disputes: [entry], nextCursor: null } });
      expect(path).toBe("/api/qa/reviews/disputes/case");
      if (request.method() === "PATCH") mutations++;
      return route.fulfill({ status, json: status === 200 ? {
        dispute: { ...entry, claimId: null, revision: 1, reason: "Private member reason.", resolution: null },
        reviewId: "review", claim: null, report: null,
      } : { message: "Review unavailable." } });
    });

    await page.goto(fixture + "/review-qa");
    await page.getByRole("button", { name: "Review disputes" }).click();
    await page.getByRole("button", { name: "Open dispute case" }).click();
    await expect(page.getByText("The dispute could not be loaded. Check your session and assignment access.")).toBeVisible();
    await expect(page.getByText("Private member reason.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Approved report" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Start review|Uphold dispute|Reject dispute/ })).toHaveCount(0);
    expect(mutations).toBe(0);
  });
}

test("QA clears evidence when switching speech observations and submits only the new evidence", async ({ page }) => {
  let approval: unknown;
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: {
      id: "moderator", role: "MODERATOR", email: "mod@example.invalid", displayName: null,
    } });
    if (path === "/api/qa/reviews") return route.fulfill({ json: { reviews: [
      { id: "review", version: 3, submittedAt: approvalTime },
    ], nextCursor: null } });
    if (path === "/api/qa/reviews/review") return route.fulfill({ json: { review: {
      id: "review", version: 3, submittedAt: approvalTime, summary: "Reported hobbies.", limitations: "One recording.",
      observations: [
        { id: "speech", category: "SPEECH", startMs: 100, endMs: 900, observation: "Mentions reading.", context: "Hobbies prompt." },
        { id: "speech-two", category: "SPEECH", startMs: 1000, endMs: 1800, observation: "Mentions a favorite book.", context: "Favorite book prompt." },
        { id: "gesture", category: "BODY", startMs: 0, endMs: 100, observation: "Gestures.", context: "Hobbies prompt." },
      ],
    }, claimTypes: [{ type: "INTEREST_READING", statement }] } });
    expect(path).toBe("/api/qa/reviews/review/approve");
    approval = request.postDataJSON();
    return route.fulfill({ json: { status: "APPROVED" } });
  });
  await page.goto(fixture + "/review-qa");
  await page.getByRole("button", { name: "Open review review" }).click();
  await page.getByRole("checkbox", { name: statement }).check();
  await expect(page.getByRole("button", { name: "Approve review" })).toBeDisabled();
  await expect(page.getByLabel("Speech observation").getByRole("option")).toHaveCount(3);
  await page.getByLabel("Speech observation").selectOption("speech");
  await page.getByLabel("Context", { exact: true }).fill("Hobbies prompt.");
  await page.getByLabel("Manual transcript (optional)").fill("I enjoy reading.");
  await page.getByLabel("Speech observation").selectOption("speech-two");
  await expect(page.getByLabel("Context", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Manual transcript (optional)")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Approve review" })).toBeDisabled();
  expect(approval).toBeUndefined();
  await page.getByLabel("Context", { exact: true }).fill("Favorite book prompt.");
  await page.getByLabel("Manual transcript (optional)").fill("I love reading mysteries.");
  await page.getByRole("button", { name: "Approve review" }).click();
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByText("Review approved.")).toBeVisible();
  expect(approval).toEqual({ expectedVersion: 3, claims: [
    { type: "INTEREST_READING", observationId: "speech-two", context: "Favorite book prompt.", transcript: "I love reading mysteries." },
  ] });
});
