import { expect, test as base, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient, type ConsentPurpose, type UserRole } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { inspectVideoProbe, VIDEO_PROBE_TIMEOUT_MS } from "../../api/src/video/video-duration";
import { clearTestEmails, findTestEmails, readActivationEmail } from "../../api/test/mailpit-fixtures";

const origin = "http://localhost:3100";
const policyVersion = "synthetic-video-e2e-v1";
const mutation = { Origin: origin };
const idempotent = () => ({ ...mutation, "Idempotency-Key": randomUUID() });

const test = base.extend<{ db: PrismaClient }>({
  db: async ({}, use) => {
    const runtime = JSON.parse(await readFile(resolve(__dirname, "../.video-e2e-runtime.json"), "utf8"));
    const database = new URL(process.env.DATABASE_URL ?? "");
    if (runtime.kind !== "vera-video-e2e-v1" || runtime.runId !== process.env.VERA_VIDEO_E2E_RUN_ID ||
      !/^vera_auth_test_[a-f0-9]{32}$/.test(runtime.schema) || !/^vera-video-e2e-[a-f0-9-]{36}$/.test(runtime.bucket) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.port !== "5433")
      throw new Error("Isolated video test runtime required.");
    database.searchParams.set("schema", runtime.schema);
    const db = new PrismaClient({ datasources: { db: { url: database.toString() } } });
    try { await use(db); } finally { await db.$disconnect(); }
  },
});

async function identity(db: PrismaClient, role: UserRole, target: BrowserContext, domain = "t08.example.invalid") {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.create({ data: {
    email: `${randomUUID()}@${domain}`, passwordHash: "synthetic-only-not-for-login",
    role, status: "ACTIVE", emailVerifiedAt: new Date(), sessions: {
      create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) },
    },
  } });
  await target.addCookies([{ name: "vera_e2e_session", value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
  return user;
}

async function checkPlaybackExpiry(db: PrismaClient, target: BrowserContext, expertId: string, workspace: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.session.create({ data: { userId: expertId, tokenHash, expiresAt: new Date(Date.now() + 60000) } });
  await target.addCookies([{ name: "vera_e2e_session", value: token, url: origin, httpOnly: true }]);
  const page = await target.newPage();
  try {
    await page.goto(workspace);
    const load = page.getByRole("button", { name: "Load playback" });
    await expect(load).toBeEnabled();
    // The real signer bounds its grant to the remaining server-side session lifetime.
    await db.session.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() + 8000) } });
    await load.click();
    const player = page.getByLabel("Assigned video");
    await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1);
    const signedUrl = await player.evaluate((element: HTMLVideoElement) => element.currentSrc);
    await expect(page.getByText("Playback expired. Load playback to continue.")).toBeVisible({ timeout: 10000 });
    await expect(player).toHaveCount(0);
    // SigV4 uses whole seconds and may accept requests during the expiry second.
    await expect.poll(async () => {
      try {
        const response = await fetch(signedUrl, { cache: "no-store", signal: AbortSignal.timeout(2000) });
        await response.body?.cancel();
        return response.status;
      }
      catch { throw new Error("Private-storage expiry check failed."); }
    }, { timeout: 5000 }).toBe(403);
    // The signed URL can expire up to a second before the session used to issue it.
    await expect.poll(async () => (await target.request.get("/api/auth/me")).status()).toBe(401);
    await load.click();
    await expect(page.getByText("Review access could not be confirmed.", { exact: false })).toBeVisible();
    await expect(player).toHaveCount(0);
  } finally {
    await page.close();
  }
}

function nativeProbePath() {
  const ffprobe = process.env.VIDEO_DURATION_FFPROBE;
  if (!ffprobe) throw new Error("Native ffprobe is required for the video tests.");
  return ffprobe;
}

function sampleVideo(container: "mp4" | "webm") {
  const ffmpeg = join(dirname(nativeProbePath()), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  // Ten frames at 10 fps. Disable B-frames so the fragmented MP4 is seekable from zero.
  return execFileSync(ffmpeg, [
    "-v", "error", "-f", "lavfi", "-i", "color=black:s=64x64:r=10",
    "-frames:v", "10", "-an", "-pix_fmt", "yuv420p", "-threads", "1",
    ...(container === "mp4" ? ["-c:v", "libx264", "-bf", "0", "-movflags", "frag_keyframe+empty_moov"] : ["-c:v", "libvpx"]),
    "-f", container, "pipe:1",
  ], { timeout: 10000, maxBuffer: 1048576, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
}

async function uploadSample(owner: BrowserContext, container: "mp4" | "webm") {
  const mimeType = `video/${container}`;
  const bytes = sampleVideo(container);
  const intent = await owner.request.post("/api/videos/upload-intent", { headers: mutation, data: {
    mimeType, sizeBytes: bytes.length,
  } });
  expect(intent.status()).toBe(201);
  const { id, uploadUrl } = await intent.json() as { id: string; uploadUrl: string };
  const put = await fetch(uploadUrl, {
    method: "PUT", headers: { "Content-Type": mimeType }, body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(10000),
  }).catch(() => { throw new Error("Synthetic video PUT failed."); });
  expect(put.ok).toBe(true);
  const confirmed = await owner.request.post(`/api/videos/${id}/confirm`, { headers: mutation, data: {} });
  expect(confirmed.status()).toBe(201);
  return id;
}

async function assignSample(staff: BrowserContext, expertId: string, videoId: string) {
  const approved = await staff.request.post(`/api/expert-admin/experts/${expertId}/approvals`, { headers: mutation, data: {
    expectedRevision: 0, trainingVersion: "t08-fixture-training", policyVersion: "t08-fixture-confidentiality",
    trainingEvidenceId: `t08-training-${expertId}`, confidentialityEvidenceId: `t08-confidentiality-${expertId}`, expiresAt: null,
  } });
  expect(approved.status()).toBe(201);
  const assigned = await staff.request.post("/api/expert-admin/assignments", { headers: idempotent(), data: {
    videoId, expertId, expectedCredentialRevision: 1, dueAt: null, expiresAt: null,
  } });
  expect(assigned.status()).toBe(201);
  const { assignment } = await assigned.json() as { assignment: { id: string } };
  return assignment.id;
}

type RecorderCapture = {
  startedAt: number;
  timedChunk: boolean;
  finalBytes: number;
  events: string[];
  finalTrackStates: MediaStreamTrackState[];
  stoppedTrackStates: MediaStreamTrackState[];
};

test("browser MediaRecorder finalizes before releasing capture tracks and produces a decoded timeline", async ({ db, page, context }, info) => {
  test.setTimeout(60000);
  const owner = await identity(db, "MEMBER", context);
  const consent = await page.request.patch("/api/consents/me", { headers: idempotent(), data: {
    expectedVersion: 0, consents: [{ purpose: "VIDEO_STORAGE", granted: true, policyVersion }],
  } });
  expect(consent.status()).toBe(200);
  await context.grantPermissions(["camera", "microphone"], { origin });
  await page.addInitScript(() => {
    const capture: RecorderCapture = {
      startedAt: 0, timedChunk: false, finalBytes: 0, events: [], finalTrackStates: [], stoppedTrackStates: [],
    };
    (window as Window & { recorderCapture?: RecorderCapture }).recorderCapture = capture;
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (timeslice?: number) {
      capture.startedAt = performance.now();
      this.addEventListener("dataavailable", event => {
        if (this.state === "inactive") {
          capture.events.push("final dataavailable");
          capture.finalBytes = event.data.size;
          capture.finalTrackStates = this.stream.getTracks().map(track => track.readyState);
        } else if (event.data.size > 0) capture.timedChunk = true;
      });
      this.addEventListener("stop", () => {
        capture.events.push("stop");
        capture.stoppedTrackStates = this.stream.getTracks().map(track => track.readyState);
      }, { once: true });
      return start.call(this, timeslice);
    };
  });
  await page.goto("/account/videos");
  await page.getByRole("button", { name: "Record a video", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await page.waitForFunction(() => {
    const capture = (window as Window & { recorderCapture?: RecorderCapture }).recorderCapture;
    return capture?.timedChunk && performance.now() - capture.startedAt >= 1500;
  });
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { recorderCapture?: RecorderCapture }).recorderCapture?.events,
  )).toEqual(["final dataavailable", "stop"]);
  const capture = await page.evaluate(() => (window as Window & { recorderCapture?: RecorderCapture }).recorderCapture);
  expect(capture?.finalBytes).toBeGreaterThan(0);
  expect(capture?.finalTrackStates).toEqual(["live", "live"]);
  expect(capture?.stoppedTrackStates).toEqual(["ended", "ended"]);
  // The application publishes the selected preview from its stop handler.
  const preview = await page.getByLabel("Selected video preview").evaluate(async (element: HTMLVideoElement) => {
    const blob = await (await fetch(element.src)).blob();
    if (blob.size === 0 || blob.size > 2 * 1024 * 1024) throw new Error("Unexpected synthetic capture size.");
    return { mime: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  });
  const start = performance.now();
  const result = await inspectVideoProbe(
    nativeProbePath(), Readable.from([Buffer.from(preview.bytes)]), preview.bytes.length,
    preview.mime, AbortSignal.timeout(VIDEO_PROBE_TIMEOUT_MS),
  );
  const diagnostic = JSON.stringify({ ...result, elapsedMs: Math.round(performance.now() - start) });
  info.annotations.push({ type: "synthetic recorder FFprobe", description: diagnostic });
  expect(result.status, diagnostic).toBe("measured");
  if (result.status === "measured") {
    expect(result.frameCount).toBeGreaterThanOrEqual(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(500);
    await page.getByRole("button", { name: "Upload private video", exact: true }).click();
    await expect(page.getByText("Your private video has been confirmed.", { exact: true })).toBeVisible();
    const uploaded = await db.video.findFirstOrThrow({ where: { ownerId: owner.id, status: "READY" } });
    expect(uploaded.durationMs).toBe(result.durationMs);
    expect(uploaded.durationRetryEtag).toBeNull();

    const playback = await page.request.post(`/api/videos/${uploaded.id}/playback`, { headers: mutation, data: {} });
    expect(playback.status()).toBe(201);
    const { url } = await playback.json() as { url: string };
    const promoted = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(5000) })
      .catch(() => { throw new Error("Could not read promoted synthetic video identity."); });
    await promoted.body?.cancel();
    expect(promoted.status).toBe(206);
    const etag = promoted.headers.get("etag");
    expect(etag).toBeTruthy();

    // Simulate a missed initial probe while keeping the actual promoted object in MinIO.
    await db.video.update({ where: { id: uploaded.id }, data: { durationMs: null, durationRetryEtag: etag } });
    const confirmPath = `/api/videos/${uploaded.id}/confirm`;
    for (let repeat = 0; repeat < 2; repeat++) {
      expect((await page.request.post(confirmPath, { headers: mutation, data: {} })).status()).toBe(201);
      expect(await db.video.findUniqueOrThrow({ where: { id: uploaded.id } }))
        .toMatchObject({ status: "READY", durationMs: result.durationMs, durationRetryEtag: null });
    }
    expect(await db.auditLog.count({ where: { action: "VIDEO_UPLOAD_CONFIRMED", subjectId: uploaded.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "VIDEO_DURATION_VERIFIED", subjectId: uploaded.id } })).toBe(1);
  }
});

for (const container of ["mp4", "webm"] as const) test(`reviewer plays synthetic ${container}, saves a draft, reloads, and loses access after withdrawal`, async ({ db, browser, page, context }) => {
  test.setTimeout(90000);
  const others = await browser.newContext({ baseURL: origin });
  const staff = await browser.newContext({ baseURL: origin });
  const ownerContext = await browser.newContext({ baseURL: origin });
  try {
    const owner = await identity(db, "MEMBER", ownerContext);
    const consent = await ownerContext.request.patch("/api/consents/me", { headers: idempotent(), data: {
      expectedVersion: 0, consents: ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"].map(purpose => ({ purpose, granted: true, policyVersion })),
    } });
    expect(consent.status()).toBe(200);
    const forgedDuration = await ownerContext.request.post("/api/videos/upload-intent", { headers: mutation, data: {
      mimeType: "video/webm", sizeBytes: 1024, durationMs: 500,
    } });
    expect(forgedDuration.status()).toBe(400);
    expect(await db.video.count({ where: { ownerId: owner.id } })).toBe(0);
    const videoId = await uploadSample(ownerContext, container);
    const video = await db.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(video.status).toBe("READY");
    expect(video.durationMs, "Confirmation must store the decoded frame span").toBe(900);

    await identity(db, "MODERATOR", staff);
    const expert = await identity(db, "EXPERT", context);
    const assignmentId = await assignSample(staff, expert.id, video.id);
    const api = `/api/expert/assignments/${assignmentId}`;
    const workspace = `/expert/assignments/${assignmentId}/review`;
    expect((await others.request.get(api + "/draft")).status()).toBe(401);
    expect((await others.request.post(api + "/playback", { headers: mutation, data: {} })).status()).toBe(401);
    expect((await ownerContext.request.get(api + "/draft")).status()).toBe(403);
    expect((await ownerContext.request.post(api + "/playback", { headers: mutation, data: {} })).status()).toBe(403);
    await page.goto(workspace);
    await page.getByRole("button", { name: "Start draft" }).click();
    await expect(page.getByRole("button", { name: "Add observation" })).toBeEnabled();
    await page.getByLabel("Summary").fill("Synthetic recording reviewed.");
    await expect(page.getByText("Saved version 2")).toBeVisible();

    const draftRow = await db.expertReview.findUniqueOrThrow({ where: { assignmentId } });
    const outside = await page.request.patch(`/api/expert/reviews/${draftRow.id}/draft`, {
      headers: mutation, data: { expectedVersion: 2, observations: [{
        category: "EYE", startMs: 0, endMs: video.durationMs! + 1,
        observation: "Synthetic movement.", context: "Opening frame.",
      }] },
    });
    expect(outside.status()).toBe(422);
    expect(await db.expertObservation.count({ where: { reviewId: draftRow.id } })).toBe(0);

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
      where: { actorId: expert.id, action: "EXPERT_PLAYBACK_ISSUED", subjectId: assignmentId },
    })).toBe(1);
    const unsignedObject = await player.evaluate((element: HTMLVideoElement) => {
      const unsigned = new URL(element.currentSrc);
      unsigned.search = "";
      return unsigned.toString();
    });
    expect((await fetch(unsignedObject, { cache: "no-store" })).status).toBe(403);
    const categories = ["EYE", "FACIAL", "BODY", "SPEECH", "CROSS_MODAL"];
    for (const [index, category] of categories.entries()) {
      await page.getByRole("button", { name: "Add observation" }).click();
      const note = page.getByRole("group", { name: `Observation ${index + 1}`, exact: true });
      await note.getByLabel("Category").selectOption(category);
      await note.getByLabel("Start (ms)").fill(String(100 + index * 100));
      await note.getByLabel("End (ms)").fill(String(video.durationMs));
      await note.getByLabel("Observable evidence").fill(`Synthetic ${category} observation.`);
      await note.getByLabel("Context").fill("Opening frame.");
      await expect(page.getByText(`Saved version ${index + 3}`, { exact: true })).toBeVisible();
    }
    await page.reload();
    await expect(page.getByLabel("Summary")).toHaveValue("Synthetic recording reviewed.");
    await expect(page.getByLabel("Category")).toHaveCount(categories.length);
    for (const [index, category] of categories.entries()) {
      const note = page.getByRole("group", { name: `Observation ${index + 1}`, exact: true });
      await expect(note.getByLabel("Category")).toHaveValue(category);
      await expect(note.getByLabel("Start (ms)")).toHaveValue(String(100 + index * 100));
      await expect(note.getByLabel("End (ms)")).toHaveValue(String(video.durationMs));
      await expect(note.getByLabel("Observable evidence")).toHaveValue(`Synthetic ${category} observation.`);
      await expect(note.getByLabel("Context")).toHaveValue("Opening frame.");
    }
    const observationsById = { observations: { orderBy: { id: "asc" as const } } };
    const saved = await db.expertReview.findUniqueOrThrow({ where: { assignmentId },
      include: observationsById });
    expect(saved.version).toBe(categories.length + 2);
    expect(saved.observations).toHaveLength(categories.length);
    expect(saved.observations).toEqual(expect.arrayContaining(categories.map((category, index) =>
      expect.objectContaining({ category, startMs: 100 + index * 100, endMs: video.durationMs }))));

    if (container === "mp4") await checkPlaybackExpiry(db, others, expert.id, workspace);
    await identity(db, "EXPERT", others);
    expect((await others.request.get(api + "/draft")).status()).toBe(404);
    expect((await others.request.post(api + "/draft", { headers: mutation, data: {} })).status()).toBe(404);
    expect((await others.request.post(api + "/playback", { headers: mutation, data: {} })).status()).toBe(404);
    const draftApi = `/api/expert/reviews/${saved.id}/draft`;
    const change = { headers: mutation, data: { expectedVersion: saved.version, summary: "Unauthorized edit" } };
    expect((await others.request.patch(draftApi, change)).status()).toBe(404);
    const foreignPage = await others.newPage();
    try {
      await foreignPage.goto(workspace);
      await expect(foreignPage.getByText("Review access could not be confirmed.", { exact: false })).toBeVisible();
      await expect(foreignPage.getByLabel("Summary")).toHaveCount(0);
      await expect(foreignPage.getByLabel("Assigned video")).toHaveCount(0);
    } finally { await foreignPage.close(); }
    expect((await ownerContext.request.patch(draftApi, change)).status()).toBe(403);
    await page.getByRole("button", { name: "Load playback" }).click();
    await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1);
    await page.getByRole("button", { name: "Jump to start" }).first().press("Enter");
    await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(0.1);
    const revoke = await ownerContext.request.patch("/api/consents/me", { headers: idempotent(), data: {
      expectedVersion: 1, consents: [{ purpose: "EXPERT_VIDEO_REVIEW", granted: false }],
    } });
    expect(revoke.status()).toBe(200);
    await page.getByLabel("Summary").fill("Attempted browser edit after withdrawal");
    await expect(page.getByText("Review access could not be confirmed.", { exact: false })).toBeVisible();
    await expect(player).toHaveCount(0);
    await expect(page.getByLabel("Summary")).toHaveCount(0);
    expect((await page.request.get(api + "/draft")).status()).toBe(403);
    expect((await page.request.post(api + "/draft", { headers: mutation, data: {} })).status()).toBe(403);
    expect((await page.request.post(api + "/playback", { headers: mutation, data: {} })).status()).toBe(403);
    expect((await page.request.patch(draftApi, change)).status()).toBe(403);
    expect(await db.expertReview.findUnique({ where: { id: saved.id }, include: observationsById })).toEqual(saved);
    expect(await db.auditLog.count({ where: { action: "EXPERT_DRAFT_SAVED", subjectId: saved.id } })).toBe(categories.length + 1);
    expect(await db.auditLog.count({ where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: assignmentId } }))
      .toBe(container === "mp4" ? 3 : 2);
    await page.reload();
    await expect(page.getByText("Review access could not be confirmed.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Observable evidence")).toHaveCount(0);
    await expect(page.getByLabel("Assigned video")).toHaveCount(0);
  } finally {
    await staff.close();
    await others.close();
    await ownerContext.close();
  }
});

test("T18 demo connects registration, private review, independent QA, owner claims and reciprocal matching", async ({ db, browser, page, context }, testInfo) => {
  test.setTimeout(120000);
  const email = `t18-${randomUUID()}@example.invalid`;
  const password = "synthetic-t18-demo-password";
  expect(await findTestEmails(email)).toEqual([]);
  const ownerContext = await browser.newContext({ baseURL: origin });
  const peerContext = await browser.newContext({ baseURL: origin });
  const qaContext = await browser.newContext({ baseURL: origin });
  const assigningStaff = await browser.newContext({ baseURL: origin });
  const members: string[] = [];
  const claimText = "The member said they enjoy reading.";
  const summary = "T16 private review summary";
  const evidence = "T16 private source observation";
  const transcript = "T16 private transcript";
  const consentContext = "T16 private evidence context";
  const auditForm = async (screen: typeof page) => {
    if (testInfo.project.name === "video-mobile") await screen.setViewportSize({ width: 320, height: 844 });
    await expect(screen.getByRole("main")).toHaveCount(1);
    expect(await screen.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const { violations } = await new AxeBuilder({ page: screen }).include("main").analyze();
    expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
  };
  const setConsent = async (actor: BrowserContext, expectedVersion: number, purposes: ConsentPurpose[], granted: boolean) => {
    const response = await actor.request.patch("/api/consents/me", { headers: idempotent(), data: {
      expectedVersion, consents: purposes.map(purpose => ({ purpose, granted, ...(granted ? { policyVersion } : {}) })),
    } });
    expect(response.status()).toBe(200);
  };

  try {
    const ownerPage = await ownerContext.newPage();
    await test.step("Register, verify with Mailpit, and sign in as the video owner", async () => {
      await ownerPage.goto("/register");
      const registration = ownerPage.getByRole("form", { name: "Create account", exact: true });
      await registration.getByLabel("Email address").fill(email);
      await registration.getByLabel(/^Password \(required\)$/).fill(password);
      await registration.getByLabel(/^Confirm password \(required\)$/).fill(password);
      await registration.getByLabel("I declare that I am 18 or older").check();
      await registration.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(ownerPage.getByRole("heading", { name: "Check your inbox." })).toBeVisible();
      expect((await ownerContext.request.get("/api/auth/me")).status()).toBe(401);
      const activation = new URL((await readActivationEmail(email)).link);
      expect(activation.origin).toBe(origin);
      await ownerPage.goto(activation.href);
      await expect(ownerPage).toHaveURL("/verify-email");
      await ownerPage.getByRole("button", { name: "Verify email", exact: true }).click();
      await expect(ownerPage.getByRole("heading", { name: "Email verified." })).toBeVisible();
      await ownerPage.getByRole("main").getByRole("link", { name: "Sign in", exact: true }).click();
      const login = ownerPage.getByRole("form", { name: "Sign in", exact: true });
      await login.getByLabel("Email address").fill(email);
      await login.getByLabel(/^Password \(required\)$/).fill(password);
      await login.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(ownerPage).toHaveURL("/account");
      await ownerPage.reload();
      await expect(ownerPage.getByText(email, { exact: true })).toBeVisible();
    });
    const owner = await db.user.findUniqueOrThrow({ where: { email } });
    expect(owner).toMatchObject({ role: "MEMBER", declaredAdult: true, status: "ACTIVE" });
    const peer = await identity(db, "MEMBER", peerContext);
    members.push(owner.id, peer.id);
    await db.user.update({ where: { id: peer.id }, data: { declaredAdult: true } });
    for (const member of [ownerContext, peerContext]) {
      const profile = await member.request.patch("/api/profile/me", { headers: mutation, data: {
        expectedRevision: 0, birthDate: "1990-01-01", visibilityEnabled: true,
      } });
      expect(profile.status()).toBe(200);
    }
    await setConsent(ownerContext, 0, [
      "VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW", "REPORT_SHARING", "PROFILE_MATCHING", "VIDEO_CLAIM_MATCHING",
    ], true);
    await setConsent(peerContext, 0, ["PROFILE_MATCHING"], true);
    const videoId = await uploadSample(ownerContext, "webm");
    await identity(db, "MODERATOR", assigningStaff);
    const expert = await identity(db, "EXPERT", context);
    const moderator = await identity(db, "MODERATOR", qaContext, "t16-qa.example.invalid");
    const assignmentId = await assignSample(assigningStaff, expert.id, videoId);

    await ownerPage.goto("/account/reviews");
    await expect(ownerPage.getByText("No approved review reports are available.")).toBeVisible();
    await page.goto(`/expert/assignments/${assignmentId}/review`);
    await page.getByRole("button", { name: "Start draft" }).press("Enter");
    const expertSummary = page.getByLabel("Summary");
    await expertSummary.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Limitations")).toBeFocused();
    const submit = page.getByRole("button", { name: "Submit for quality review" });
    await expect(submit).toBeDisabled();
    await expertSummary.fill(summary);
    await page.getByLabel("Limitations").fill("One synthetic recording.");
    await page.getByRole("button", { name: "Add observation" }).press("Enter");
    await expect(page.getByText("Enter evidence, context and valid start and end times to save your changes.")).toBeVisible();
    await auditForm(page);
    const note = page.getByRole("group", { name: "Observation 1", exact: true });
    await note.getByLabel("Category").selectOption("SPEECH");
    await note.getByLabel("Start (ms)").fill("100");
    await note.getByLabel("End (ms)").fill("800");
    await note.getByLabel("Observable evidence").fill(evidence);
    await note.getByLabel("Context").fill(consentContext);
    await expect(submit).toBeEnabled();
    await submit.press("Enter");
    const submission = page.getByRole("dialog");
    await expect(submission.getByRole("heading")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(submit).toBeFocused();
    await submit.press("Enter");
    await submission.getByRole("button", { name: "Confirm submission" }).press("Enter");
    await expect(page.getByText("Submitted for quality review", { exact: true })).toBeVisible();
    const review = await db.expertReview.findUniqueOrThrow({ where: { assignmentId } });
    expect(review.status).toBe("SUBMITTED");
    const qaPath = `/api/qa/reviews/${review.id}`;
    const approveWithoutAccess = (actor: BrowserContext) => actor.request.post(qaPath + "/approve", {
      headers: mutation, data: { expectedVersion: review.version },
    });
    expect((await approveWithoutAccess(context)).status()).toBe(403);
    expect((await approveWithoutAccess(assigningStaff)).status()).toBe(403);
    expect((await approveWithoutAccess(qaContext)).status()).toBe(404);
    await ownerPage.reload();
    await expect(ownerPage.getByText("No approved review reports are available.")).toBeVisible();

    // PA2 is an internal service. Use its real transaction with synthetic, actor-bound providers.
    const { AssignmentGrantsService } = require("../../api/dist/expert-admin/assignment-grants.service") as
      typeof import("../../api/src/expert-admin/assignment-grants.service");
    const admin = await db.user.create({ data: {
      email: `${randomUUID()}@t16-admin.example.invalid`, passwordHash: "synthetic-only",
      role: "ADMIN", status: "ACTIVE", emailVerifiedAt: new Date(),
    } });
    const session = await db.session.create({ data: {
      userId: admin.id, tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      expiresAt: new Date(Date.now() + 600000),
    } });
    const grants = new AssignmentGrantsService(db as unknown as import("../../api/src/database/prisma.service").PrismaService,
      { values: { nodeEnv: "test" } } as import("../../api/src/config/environment.service").EnvironmentService,
      { resolve: async (_tx, auth) => auth.user.id === admin.id ? {
        userId: admin.id, role: "ADMIN", active: true, reference: "synthetic-t16", testOnly: true,
      } : undefined },
      { resolve: async (_tx, auth) => auth.sessionId === session.id ? {
        userId: admin.id, sessionId: session.id, level: "MFA", verifiedAt: session.createdAt,
        expiresAt: session.expiresAt, testOnly: true,
      } : undefined });
    await grants.grant({ user: admin, sessionId: session.id }, {
      assignmentId, moderatorId: moderator.id, expectedRevision: 0, expiresAt: session.expiresAt.toISOString(),
    });
    const staleApproval = await qaContext.request.post(qaPath + "/approve", {
      headers: mutation, data: { expectedVersion: review.version - 1 },
    });
    expect(staleApproval.status()).toBe(409);
    expect(await db.expertReview.findUnique({ where: { id: review.id } })).toMatchObject({
      status: "SUBMITTED", version: review.version,
    });
    const qa = await qaContext.newPage();
    await qa.goto("/qa/reviews");
    await qa.getByRole("button", { name: `Open review ${review.id}` }).press("Enter");
    await expect(qa.getByText(evidence, { exact: true })).toBeVisible();
    await qa.getByRole("checkbox", { name: claimText }).press("Space");
    const approve = qa.getByRole("button", { name: "Approve review" });
    await expect(approve).toBeDisabled();
    const speech = qa.getByLabel("Speech observation");
    await speech.selectOption({ index: 1 });
    await speech.focus();
    await qa.keyboard.press("Tab");
    await expect(qa.getByLabel("Context", { exact: true })).toBeFocused();
    await qa.getByLabel("Context", { exact: true }).fill(consentContext);
    await qa.getByLabel("Manual transcript (optional)").fill(transcript);
    await auditForm(qa);
    await approve.press("Enter");
    const decisionDialog = qa.getByRole("dialog");
    await expect(decisionDialog.getByRole("heading")).toBeFocused();
    await decisionDialog.getByRole("button", { name: "Confirm approval" }).press("Enter");
    await expect(qa.getByRole("status").filter({ hasText: "Review approved." })).toBeVisible();

    const foreignReports = await peerContext.request.get("/api/reviews/me");
    expect(foreignReports.status()).toBe(200);
    expect(await foreignReports.json()).toEqual({ reports: [], nextCursor: null });
    await ownerPage.reload();
    await expect(ownerPage.getByText(summary, { exact: true })).toBeVisible();
    await expect(ownerPage.getByText(transcript, { exact: true })).toBeVisible();
    await auditForm(ownerPage);

    const matches = await peerContext.newPage();
    const readReasons = async (shared: boolean) => {
      const apiRead = matches.waitForResponse(response =>
        new URL(response.url()).pathname === "/api/matches/recommendations" && response.ok());
      await matches.goto("/account/matches");
      const response = await apiRead;
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      const result = await response.json();
      expect(result).toEqual({
        available: true, nextCursor: null,
        recommendations: [{ key: expect.any(String), pairId: expect.any(String),
          reasons: shared ? ["Meets both members’ matching settings.", claimText] : ["Meets both members’ matching settings."] }],
      });
      for (const privateValue of [summary, evidence, transcript, consentContext, owner.id, peer.id, review.id, videoId]) {
        expect(JSON.stringify(result)).not.toContain(privateValue);
      }
      const reason = matches.getByText(claimText, { exact: true });
      await expect(matches.getByText("Meets both members’ matching settings.", { exact: true })).toBeVisible();
      if (shared) await expect(reason).toBeVisible();
      else await expect(reason).toHaveCount(0);
      return result.recommendations[0].pairId as string;
    };
    await readReasons(false);
    await ownerPage.getByRole("button", { name: "Confirm this claim" }).press("Enter");
    await expect(ownerPage.getByText("Confirmed · not shared")).toBeVisible();
    await readReasons(false);
    const share = ownerPage.getByRole("button", { name: "Share this claim for matching" });
    await share.press("Enter");
    await expect(ownerPage.getByText("Sharing approved for matching")).toBeVisible();
    const beforeBlock = await readReasons(true);
    await test.step("Block an eligible peer and verify that the shared claim disappears", async () => {
      const block = await ownerContext.request.post("/api/blocks", {
        headers: mutation, data: { targetUserId: peer.id },
      });
      expect(block.status()).toBe(204);
      const recommendations = await peerContext.request.get("/api/matches/recommendations");
      expect(recommendations.status()).toBe(200);
      expect(await recommendations.json()).toEqual({ available: true, nextCursor: null, recommendations: [] });
      await matches.reload();
      await expect(matches.getByRole("heading", { name: "No recommendations on this page" })).toBeVisible();
      await expect(matches.getByText(claimText, { exact: true })).toHaveCount(0);
      const unblock = await ownerContext.request.delete(`/api/blocks/${peer.id}`, { headers: mutation, data: {} });
      expect(unblock.status()).toBe(204);
      const stale = await peerContext.request.post(`/api/matches/${beforeBlock}/decision`, {
        headers: mutation, data: { choice: "ACCEPT" },
      });
      expect(stale.status()).toBe(404);
      expect(await stale.json()).toMatchObject({ code: "MATCH_UNAVAILABLE" });
      await readReasons(true);
    });
    await setConsent(ownerContext, 1, ["VIDEO_CLAIM_MATCHING"], false);
    await readReasons(false);
    await ownerPage.reload();
    await share.press("Enter");
    await expect(ownerPage.getByRole("main").getByRole("alert"))
      .toContainText("Enable profile matching, report sharing, and video claim matching");
    await auditForm(ownerPage);
    await setConsent(ownerContext, 2, ["VIDEO_CLAIM_MATCHING"], true);
    await readReasons(false);
    await ownerPage.getByRole("button", { name: "Reload report", exact: true }).press("Enter");
    await share.press("Enter");
    await expect(ownerPage.getByText("Sharing approved for matching")).toBeVisible();
    await readReasons(true);
    await ownerPage.getByRole("button", { name: "Revoke this claim" }).press("Enter");
    const revoke = ownerPage.getByRole("dialog");
    await expect(revoke.getByRole("heading")).toBeFocused();
    await revoke.getByRole("button", { name: "Confirm revocation" }).press("Enter");
    await expect(ownerPage.getByText("Revoked", { exact: true })).toBeVisible();
    const peerReference = await readReasons(false);

    const foreignDecision = await ownerContext.request.post(`/api/matches/${peerReference}/decision`, {
      headers: mutation, data: { choice: "ACCEPT" },
    });
    expect(foreignDecision.status()).toBe(404);
    expect(await foreignDecision.json()).toMatchObject({ code: "MATCH_UNAVAILABLE" });
    expect(await db.matchDecision.count({ where: { actorUserId: { in: members } } })).toBe(0);
    await matches.getByRole("button", { name: "Accept", exact: true }).press("Enter");
    await expect(matches.getByText("Acceptance saved.")).toBeVisible();
    await expect(matches.getByText("Mutual match", { exact: false })).toHaveCount(0);
    await ownerPage.goto("/account/matches");
    await ownerPage.getByRole("button", { name: "Accept", exact: true }).press("Enter");
    await expect(ownerPage.getByText("Mutual match", { exact: false })).toBeVisible();
    await matches.reload();
    await expect(matches.getByText("Mutual match", { exact: false })).toBeVisible();
    await setConsent(ownerContext, 3, ["PROFILE_MATCHING"], false);
    await matches.reload();
    await expect(matches.getByText("Accepted ·", { exact: false })).toContainText("Unavailable");
    await expect(matches.getByText("Mutual match", { exact: false })).toHaveCount(0);
    const history = await peerContext.request.get("/api/matches/decisions");
    expect(history.status()).toBe(200);
    expect(await history.json()).toEqual({ decisions: [{
      id: expect.any(String), choice: "ACCEPT", createdAt: expect.any(String), available: false, mutual: false,
    }], nextCursor: null });
    expect(await db.matchDecision.count({ where: { actorUserId: { in: members } } })).toBe(2);
  } finally {
    try {
      await Promise.all([ownerContext.close(), peerContext.close(), qaContext.close(), assigningStaff.close()]);
    } finally {
      // Keep later browser cases isolated even if a browser context failed during teardown.
      try {
        await db.profile.updateMany({ where: { userId: { in: members } }, data: { visibilityEnabled: false } });
      } finally {
        await clearTestEmails(email);
        expect(await findTestEmails(email)).toEqual([]);
      }
    }
  }
});
