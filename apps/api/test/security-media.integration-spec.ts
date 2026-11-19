import { AssignmentCancellationService } from "../src/assignment-cancellation/assignment-cancellation.service";
import { VideoCleanupService } from "../src/video/video-cleanup.service";
import { ExpertMfaSource } from "../src/expert-admin/expert-mfa.source";
import { PrivateStorageService } from "../src/video/private-storage.service";
import {
  securityMediaHarness,
  SecurityMediaHarness,
} from "./security-media-fixtures";

type Grant = { url: string; expiresAt: string };
describe("C085 actual C034/C051 media boundary / native MinIO", () => {
  let h: SecurityMediaHarness;
  beforeAll(async () => {
    h = await securityMediaHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  test("the provider enforces the actual C034 assignment deadline, range privacy and signed TTL integrity", async () => {
    const f = await h.fixture(5000),
      response = await h.play(f.expert.cookie, f.id);
    expect(response.status).toBe(200);
    const grant = (await response.json()) as Grant,
      url = new URL(grant.url);
    expect(new Date(grant.expiresAt).getTime()).toBeLessThanOrEqual(
      Date.parse(f.expiresAt!),
    );
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(
      5,
    );
    expect((await fetch(grant.url)).status).toBe(200);
    const range = await fetch(grant.url, { headers: { Range: "bytes=0-3" } });
    expect(range.status).toBe(206);
    expect((await range.arrayBuffer()).byteLength).toBe(4);
    expect(range.headers.get("cache-control")).toBe("private, no-store");
    const anonymous = url.origin + url.pathname;
    for (const method of ["GET", "HEAD"])
      expect((await fetch(anonymous, { method })).status).toBe(403);
    url.searchParams.set("X-Amz-Expires", "60");
    expect((await fetch(url)).status).toBe(403);
    const wait = Date.parse(grant.expiresAt) - Date.now() + 1200;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    expect((await fetch(grant.url)).status).toBe(403);
    expect((await h.play(f.expert.cookie, f.id)).status).toBe(403);
  });
  test("positive consent cannot turn a foreign video or assignment reference into access", async () => {
    const f = await h.fixture(),
      stranger = await h.account();
    await h.storageConsent(stranger);
    for (const suffix of ["/confirm", "/playback", ""])
      expect(
        (
          await h.request(
            stranger.cookie,
            "videos/" + f.videoId + suffix,
            {},
            suffix ? "POST" : "DELETE",
          )
        ).status,
      ).toBe(404);
    const list = await h.request(
      stranger.cookie,
      "videos/me",
      undefined,
      "GET",
    );
    expect(await list.json()).toEqual({ videos: [], nextCursor: null });
    const otherExpert = await h.account("EXPERT");
    h.proofs.set(otherExpert.sessionId, {
      userId: otherExpert.id,
      sessionId: otherExpert.sessionId,
      expiresAt: new Date(Date.now() + 600000),
      testOnly: true,
    });
    const denied = await h.play(otherExpert.cookie, f.id),
      absent = await h.play(otherExpert.cookie, "valid_unknown_assignment");
    expect(denied.status).toBe(404);
    expect(await denied.json()).toEqual(await absent.json());
  });
  test("review withdrawal and re-consent cannot revive old access; an explicit new C033 assignment is required", async () => {
    const f = await h.fixture();
    await h.consent(f.owner, 2, "EXPERT_VIDEO_REVIEW", false);
    expect((await h.play(f.expert.cookie, f.id)).status).toBe(403);
    const ledger = await h.db.client.consentLedger.findUniqueOrThrow({
      where: { userId: f.owner.id },
    });
    const task = await h.db.client.consentWithdrawalTask.findFirstOrThrow({
      where: {
        subjectId: ledger.subjectId,
        version: 3n,
        purpose: "EXPERT_VIDEO_REVIEW",
      },
    });
    expect(
      await h.app.get(AssignmentCancellationService).processWithdrawal(task.id),
    ).toMatchObject({ completed: true, cancelled: 1 });
    await h.consent(f.owner, 3, "EXPERT_VIDEO_REVIEW", true);
    expect((await h.play(f.expert.cookie, f.id)).status).toBe(403);
    const replacement = await h.assign(
      f.owner,
      f.moderator,
      f.expert,
      f.videoId,
    );
    expect(replacement === f.id).toBe(false);
    const response = await h.play(f.expert.cookie, replacement);
    expect(response.status).toBe(200);
    expect((await fetch(((await response.json()) as Grant).url)).status).toBe(
      200,
    );
    expect(
      await h.app.get(AssignmentCancellationService).processWithdrawal(task.id),
    ).toMatchObject({ cancelled: 0 });
    expect((await h.play(f.expert.cookie, replacement)).status).toBe(200);
  });
  test.each(["play-first", "delete-first"] as const)(
    "C034 versus owner deletion is linearized under real database locks (%s)",
    async (order) => {
      const f = await h.fixture();
      // Each ordering starts authorized; a missing fixture proof must not mask deletion.
      expect((await h.play(f.expert.cookie, f.id)).status).toBe(200);
      const previousAudits = await h.db.client.auditLog.count({
        where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: f.id },
      });
      let entered!: () => void,
        release!: () => void,
        pid = 0;
      const ready = new Promise<void>((r) => {
          entered = r;
        }),
        barrier = new Promise<void>((r) => {
          release = r;
        });
      const cancellation = h.app.get(AssignmentCancellationService),
        source = h.app.get(ExpertMfaSource);
      const originalCancel =
          cancellation.cancelDeletedVideoInTransaction.bind(cancellation),
        originalProof = (
          source.resolve as jest.MockedFunction<ExpertMfaSource["resolve"]>
        ).getMockImplementation()!;
      const hold = async (
        tx: import("@prisma/client").Prisma.TransactionClient,
      ) => {
        const [backend] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        pid = backend.pid;
        entered();
        await barrier;
      };
      const spy =
        order === "play-first"
          ? jest
              .spyOn(source, "resolve")
              .mockImplementationOnce(async (auth, tx) => {
                await hold(tx);
                return originalProof(auth, tx);
              })
          : jest
              .spyOn(cancellation, "cancelDeletedVideoInTransaction")
              .mockImplementationOnce(async (tx, ...args) => {
                const result = await originalCancel(tx, ...args);
                await hold(tx);
                return result;
              });
      const sign = jest.spyOn(
        h.app.get(PrivateStorageService),
        "playbackGrant",
      );
      const remove = () =>
        h.request(f.owner.cookie, "videos/" + f.videoId, {}, "DELETE");
      const first =
        order === "play-first" ? h.play(f.expert.cookie, f.id) : remove();
      let second: Promise<Response> | undefined;
      try {
        await Promise.race([ready, first]);
        second =
          order === "play-first" ? remove() : h.play(f.expert.cookie, f.id);
        let blocked = false;
        for (const until = Date.now() + 5000; Date.now() < until;) {
          const rows = await h.db.client.$queryRaw<
            { pid: number }[]
          >`SELECT pid FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))`;
          if (rows.length) {
            blocked = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(blocked).toBe(true);
        release();
        const a = await first,
          b = await second;
        const playback = order === "play-first" ? a : b,
          deletion = order === "play-first" ? b : a;
        expect(deletion.status).toBe(202);
        expect(playback.status).toBe(order === "play-first" ? 200 : 403);
        expect(sign.mock.calls).toHaveLength(order === "play-first" ? 1 : 0);
        const grant =
          order === "play-first"
            ? ((await playback.json()) as Grant)
            : undefined;
        expect((await h.play(f.expert.cookie, f.id)).status).toBe(403);
        expect(
          await h.db.client.expertAssignment.findUnique({
            where: { id: f.id },
          }),
        ).toMatchObject({ status: "CANCELLED", revision: 1n });
        expect(
          await h.db.client.assignmentCancellationContext.count({
            where: { event: { assignmentId: f.id } },
          }),
        ).toBe(1);
        expect(
          await h.db.client.auditLog.count({
            where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: f.id },
          }),
        ).toBe(previousAudits + (order === "play-first" ? 1 : 0));
        // A previously issued bearer can still work until cleanup or expiry.
        if (grant) expect((await fetch(grant.url)).status).toBe(200);
        await h.app.get(VideoCleanupService).runOnce();
        const metadata = await h.db.client.video.findUniqueOrThrow({
          where: { id: f.videoId },
        });
        expect(await h.finalObjectAbsent(f.videoId)).toBe(true);
        // The still-live incoming PUT capability can recreate staging bytes; do not
        // pretend whole-task erasure completed before that real URL expires.
        expect(metadata.cleanupCompletedAt).toBeNull();
        expect(
          await h.db.client.videoCleanupTask.findUnique({
            where: { videoId: f.videoId },
          }),
        ).toMatchObject({ status: "PENDING", completedAt: null });
        if (grant) expect((await fetch(grant.url)).status).toBe(404);
      } finally {
        release();
        await Promise.allSettled([first, ...(second ? [second] : [])]);
        if (order === "play-first") {
          // The source was already a fixture spy. mockRestore would remove its
          // proof resolver and make the following ordering fail for missing MFA.
          (source.resolve as jest.MockedFunction<ExpertMfaSource["resolve"]>)
            .mockReset()
            .mockImplementation(originalProof);
        } else spy.mockRestore();
        sign.mockRestore();
      }
    },
  );
});
