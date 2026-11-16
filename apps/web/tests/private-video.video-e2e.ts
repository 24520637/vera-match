import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("real recording upload playback deletion and consent withdrawal", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120000);
  const metadata = JSON.parse(
    await readFile(resolve(__dirname, "../.video-e2e-runtime.json"), "utf8"),
  );
  if (
    metadata.kind !== "vera-video-e2e-v1" ||
    metadata.runId !== process.env.VERA_VIDEO_E2E_RUN_ID ||
    !/^vera_auth_test_[a-f0-9]{32}$/.test(metadata.schema)
  )
    throw Error("Isolated runtime required");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== "5433"
  )
    throw Error("Local database required");
  url.searchParams.set("schema", metadata.schema);
  const db = new PrismaClient({
    datasources: { db: { url: url.toString() } },
    log: [],
  });
  const token = randomBytes(32).toString("base64url");
  try {
    const user = await db.user.create({
      data: {
        email: `video-ui-${randomUUID()}@example.invalid`,
        passwordHash: "synthetic-only-not-for-login",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        sessions: {
          create: {
            tokenHash: createHash("sha256").update(token).digest("hex"),
            expiresAt: new Date(Date.now() + 600000),
          },
        },
      },
    });
    await context.addCookies([
      {
        name: "vera_e2e_session",
        value: token,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await context.grantPermissions(["camera", "microphone"], {
      origin: "http://localhost:3100",
    });
    const grant = await page.request.patch("/api/consents/me", {
      headers: {
        Origin: "http://localhost:3100",
        "Idempotency-Key": randomUUID(),
      },
      data: {
        expectedVersion: 0,
        consents: [
          {
            purpose: "VIDEO_STORAGE",
            granted: true,
            policyVersion: "synthetic-video-e2e-v1",
          },
        ],
      },
    });
    expect(grant.status()).toBe(200);
    await page.goto("/account/videos");
    await expect(
      page.getByText("No videos yet", { exact: true }),
    ).toBeVisible();
    async function recordAndUpload() {
      await page
        .getByRole("button", { name: "Record a video", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Stop recording" }),
      ).toBeVisible();
      await page.waitForTimeout(1200); // Collect one real synthetic camera chunk.
      await page.getByRole("button", { name: "Stop recording" }).click();
      await expect(
        page.getByText("Local preview. This video has not been uploaded yet."),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Upload private video", exact: true })
        .click();
      await expect(
        page.getByText("Your private video has been confirmed.", {
          exact: true,
        }),
      ).toBeVisible();
    }
    await recordAndUpload();
    await page
      .getByRole("button", { name: "Play video 1", exact: true })
      .click();
    const player = page.getByLabel("Private playback video 1");
    await expect(player).toBeVisible();
    await expect
      .poll(() =>
        player.evaluate((element: HTMLVideoElement) => element.readyState),
      )
      .toBeGreaterThanOrEqual(1);
    expect(
      (await new AxeBuilder({ page }).include(".private-videos").analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("private-video-review.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Delete video 1", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("button", { name: "Delete private video", exact: true })
      .click();
    await expect(
      page.getByText("Access removed. Object cleanup pending.", {
        exact: true,
      }),
    ).toBeVisible();
    const removed = await db.video.findFirstOrThrow({
      where: { ownerId: user.id, status: "DELETED" },
    });
    // Let the real worker finish its first removal pass before advancing this
    // fixture's expiry. Mutating a RUNNING task races its leased snapshot and
    // can legitimately restore the original future nextAttemptAt on commit.
    await expect
      .poll(
        async () => {
          const task = await db.videoCleanupTask.findUniqueOrThrow({
            where: { videoId: removed.id },
          });
          return (
            task.status === "PENDING" &&
            task.attempts > 0 &&
            task.lastErrorCode === null &&
            task.nextAttemptAt.getTime() > Date.now() + 30000
          );
        },
        { timeout: 15000 },
      )
      .toBe(true);
    const advanced = await db.videoCleanupTask.updateMany({
      where: {
        videoId: removed.id,
        status: "PENDING",
        lastErrorCode: null,
        nextAttemptAt: { gt: new Date(Date.now() + 30000) },
      },
      data: { uploadExpiresAt: new Date(0), nextAttemptAt: new Date(0) },
    });
    expect(advanced.count).toBe(1);
    await expect
      .poll(
        async () =>
          (await db.video.findUniqueOrThrow({ where: { id: removed.id } }))
            .cleanupCompletedAt,
        { timeout: 15000 },
      )
      .not.toBeNull();
    await page
      .getByRole("button", { name: "Refresh video list", exact: true })
      .click();
    await expect(
      page.getByText("Deleted. Object cleanup verified.", { exact: true }),
    ).toBeVisible();
    await recordAndUpload();
    const revoke = await page.request.patch("/api/consents/me", {
      headers: {
        Origin: "http://localhost:3100",
        "Idempotency-Key": randomUUID(),
      },
      data: {
        expectedVersion: 1,
        consents: [{ purpose: "VIDEO_STORAGE", granted: false }],
      },
    });
    expect(revoke.status()).toBe(200);
    await page
      .getByRole("button", { name: "Refresh video list", exact: true })
      .click();
    await expect(
      page.getByText("Playback requires current consent", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Private playback video 2")).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
      })),
    ).toEqual({ local: 0, session: 0 });
  } finally {
    await db.$disconnect();
  }
});
