import { expect, test } from "@playwright/test";
import { PrismaClient, type UserRole } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "http://localhost:3100";
const policyVersion = "synthetic-video-e2e-v1";

test("reviewer plays private media, saves a draft, reloads, and loses access after withdrawal", async ({ browser, page, context }) => {
  test.setTimeout(90000);
  const runtime = JSON.parse(await readFile(resolve(__dirname, "../.video-e2e-runtime.json"), "utf8"));
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (runtime.kind !== "vera-video-e2e-v1" || runtime.runId !== process.env.VERA_VIDEO_E2E_RUN_ID ||
    !/^vera_auth_test_[a-f0-9]{32}$/.test(runtime.schema) || !/^vera-video-e2e-[a-f0-9-]{36}$/.test(runtime.bucket) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.port !== "5433")
    throw new Error("Isolated video test runtime required.");
  database.searchParams.set("schema", runtime.schema);
  const db = new PrismaClient({ datasources: { db: { url: database.toString() } } });
  const others = await browser.newContext({ baseURL: origin });
  const staff = await browser.newContext({ baseURL: origin });
  async function identity(role: UserRole, target: typeof context) {
    const token = randomBytes(32).toString("base64url");
    const user = await db.user.create({ data: {
      email: `${randomUUID()}@t08.example.invalid`, passwordHash: "synthetic-only-not-for-login",
      role, status: "ACTIVE", emailVerifiedAt: new Date(), sessions: {
        create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) },
      },
    } });
    await target.addCookies([{ name: "vera_e2e_session", value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
    return user;
  }
  const mutation = { Origin: origin };
  const idempotent = () => ({ ...mutation, "Idempotency-Key": randomUUID() });
  try {
    const owner = await identity("MEMBER", context);
    const consent = await page.request.patch("/api/consents/me", { headers: idempotent(), data: {
      expectedVersion: 0, consents: ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"].map(purpose => ({ purpose, granted: true, policyVersion })),
    } });
    expect(consent.status()).toBe(200);
    const forgedDuration = await page.request.post("/api/videos/upload-intent", { headers: mutation, data: {
      mimeType: "video/webm", sizeBytes: 1024, durationMs: 500,
    } });
    expect(forgedDuration.status()).toBe(400);
    expect(await db.video.count({ where: { ownerId: owner.id } })).toBe(0);
    await context.grantPermissions(["camera", "microphone"], { origin });
    await page.goto("/account/videos");
    await page.getByRole("button", { name: "Record a video", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
    await page.waitForTimeout(1500); // Collect a real synthetic camera recording.
    await page.getByRole("button", { name: "Stop recording" }).click();
    await page.getByRole("button", { name: "Upload private video", exact: true }).click();
    await expect(page.getByText("Your private video has been confirmed.", { exact: true })).toBeVisible({ timeout: 15000 });
    const video = await db.video.findFirstOrThrow({ where: { ownerId: owner.id, status: "READY" } });
    expect(video.durationMs).toBeNull(); // Upload confirmation has no trusted duration producer.

    await identity("MODERATOR", staff);
    const expert = await identity("EXPERT", context);
    const approved = await staff.request.post(`/api/expert-admin/experts/${expert.id}/approvals`, { headers: mutation, data: {
      expectedRevision: 0, trainingVersion: "t08-fixture-training", policyVersion: "t08-fixture-confidentiality",
      trainingEvidenceId: `t08-training-${expert.id}`, confidentialityEvidenceId: `t08-confidentiality-${expert.id}`, expiresAt: null,
    } });
    expect(approved.status()).toBe(201);
    const assigned = await staff.request.post("/api/expert-admin/assignments", { headers: idempotent(), data: {
      videoId: video.id, expertId: expert.id, expectedCredentialRevision: 1, dueAt: null, expiresAt: null,
    } });
    expect(assigned.status()).toBe(201);
    const { assignment } = await assigned.json() as { assignment: { id: string } };
    const api = `/api/expert/assignments/${assignment.id}`;
    const workspace = `/expert/assignments/${assignment.id}/review`;
    await page.goto(workspace);
    await page.getByRole("button", { name: "Start draft" }).click();
    await expect(page.getByRole("button", { name: "Add observation" })).toBeDisabled();
    await page.getByLabel("Summary").fill("Synthetic recording reviewed.");
    await expect(page.getByText("Saved version 2")).toBeVisible();

    // Explicit test fixture. This is not evidence of a production duration extractor.
    await db.video.update({ where: { id: video.id }, data: { durationMs: 500 } });
    await page.reload();
    await expect(page.getByLabel("Summary")).toHaveValue("Synthetic recording reviewed.");
    await page.getByRole("button", { name: "Load playback" }).click();
    const player = page.getByLabel("Assigned video");
    await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1);
    await player.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      try { await element.play(); }
      catch { throw new Error("Private playback could not start."); }
    });
    await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
    await player.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 0; });
    await expect.poll(() => db.auditLog.count({
      where: { actorId: expert.id, action: "EXPERT_PLAYBACK_ISSUED", subjectId: assignment.id },
    })).toBe(1);
    const unsignedObject = await player.evaluate((element: HTMLVideoElement) => {
      const unsigned = new URL(element.currentSrc);
      unsigned.search = "";
      return unsigned.toString();
    });
    expect((await fetch(unsignedObject, { cache: "no-store" })).status).toBe(403);
    await page.getByRole("button", { name: "Add observation" }).click();
    await page.getByLabel("Observable evidence").fill("Synthetic movement.");
    await page.getByLabel("Context").fill("Opening frame.");
    await expect(page.getByText("Saved version 3")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Observable evidence")).toHaveValue("Synthetic movement.");
    const saved = await db.expertReview.findUniqueOrThrow({ where: { assignmentId: assignment.id },
      include: { observations: true } });
    expect(saved.version).toBe(3);

    await identity("EXPERT", others);
    expect((await others.request.get(api + "/draft")).status()).toBe(404);
    expect((await others.request.post(api + "/playback", { headers: mutation, data: {} })).status()).toBe(404);
    const draftApi = `/api/expert/reviews/${saved.id}/draft`;
    const change = { headers: mutation, data: { expectedVersion: saved.version, summary: "Unauthorized edit" } };
    expect((await others.request.patch(draftApi, change)).status()).toBe(404);
    // Restore the original owner cookie without creating a new owner.
    const ownerContext = await browser.newContext({ baseURL: origin });
    try {
      const token = randomBytes(32).toString("base64url");
      await db.session.create({ data: { userId: owner.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60000) } });
      await ownerContext.addCookies([{ name: "vera_e2e_session", value: token, url: origin, httpOnly: true }]);
      const revoke = await ownerContext.request.patch("/api/consents/me", { headers: idempotent(), data: {
        expectedVersion: 1, consents: [{ purpose: "EXPERT_VIDEO_REVIEW", granted: false }],
      } });
      expect(revoke.status()).toBe(200);
    } finally { await ownerContext.close(); }
    expect((await page.request.post(api + "/playback", { headers: mutation, data: {} })).status()).toBe(403);
    expect((await page.request.patch(draftApi, change)).status()).toBe(403);
    expect(await db.expertReview.findUnique({ where: { id: saved.id }, include: { observations: true } })).toEqual(saved);
    expect(await db.auditLog.count({ where: { action: "EXPERT_DRAFT_SAVED", subjectId: saved.id } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: assignment.id } })).toBe(1);
    await page.reload();
    await expect(page.getByText("Review access could not be confirmed.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Observable evidence")).toHaveCount(0);
    await expect(page.getByLabel("Assigned video")).toHaveCount(0);
  } finally {
    await staff.close();
    await others.close();
    await db.$disconnect();
  }
});
