import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../src/auth/auth-context";
import { StaffAssuranceSource } from "../src/safety/staff-assurance.source";
import { AssignmentGrantProvisioningSource } from "../src/expert-admin/assignment-grant-provisioning.source";
import { AssignmentGrantsService } from "../src/expert-admin/assignment-grants.service";
import { securityMediaHarness, SecurityMediaHarness } from "./security-media-fixtures";

export type WorkflowStage = "assigned" | "draft" | "submitted" | "approved" | "confirmed" | "shared";
export type Restriction = "VIDEO_STORAGE" | "EXPERT_VIDEO_REVIEW" | "DELETE";

export async function integratedWorkflowHarness() {
  const probe = process.env.VIDEO_DURATION_FFPROBE;
  if (!probe || !isAbsolute(probe)) throw Error("Native FFprobe required for real workflow fixtures");
  const ffmpeg = join(dirname(probe), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const media = execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10",
    "-t", "1.2", "-c:v", "libx264", "-threads", "1", "-bf", "0", "-pix_fmt", "yuv420p",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"],
  { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const h = await securityMediaHarness({ isolatedClients: true });
  type Actor = Awaited<ReturnType<typeof h.account>>;
  const staff = new Set<string>(), admins = new Set<string>();
  // Explicit test-only sources, never an environment switch or production proof.
  const spies = [
    jest.spyOn(h.app.get(StaffAssuranceSource), "resolve").mockImplementation(async (_tx, auth) =>
      staff.has(auth.sessionId) ? { userId: auth.user.id, sessionId: auth.sessionId, level: "MFA",
        verifiedAt: new Date(0), expiresAt: new Date(Date.now() + 600000), testOnly: true } : undefined),
    jest.spyOn(h.app.get(AssignmentGrantProvisioningSource), "resolve").mockImplementation(async (_tx, auth) =>
      admins.has(auth.user.id) ? { userId: auth.user.id, role: "ADMIN", active: true,
        reference: "synthetic-workflow-admin", testOnly: true } : undefined),
  ];
  async function context(actor: Actor): Promise<AuthContext> {
    return { sessionId: actor.sessionId, user: { id: actor.id, email: actor.email,
      displayName: actor.displayName, role: actor.role } };
  }
  async function workflow(stage: WorkflowStage = "shared") {
    const f = await h.fixture(undefined, media);
    const metadata = await h.db.client.video.findUniqueOrThrow({ where: { id: f.videoId } });
    expect(metadata.durationMs).toBeGreaterThanOrEqual(500); // Measured by the actual confirmation path.
    const admin = await h.account("ADMIN");
    staff.add(admin.sessionId); staff.add(f.moderator.sessionId); admins.add(admin.id);
    await h.app.get(AssignmentGrantsService).grant(await context(admin), {
      assignmentId: f.id, moderatorId: f.moderator.id, expectedRevision: 0,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });
    const extra = await h.request(f.owner.cookie, "consents/me", { expectedVersion: 2, consents:
      ["PROFILE_MATCHING", "REPORT_SHARING", "VIDEO_CLAIM_MATCHING"].map(purpose => ({
        purpose, granted: true, policyVersion: "synthetic-security-v1",
      })) }, "PATCH");
    expect(extra.status).toBe(200);
    const initPath = "expert/assignments/" + f.id + "/draft";
    let reviewId = "", observationId = "", claimId = "";
    if (stage !== "assigned") {
      expect((await h.request(f.expert.cookie, initPath, {})).status).toBe(200);
      reviewId = (await h.db.client.expertReview.findUniqueOrThrow({ where: { assignmentId: f.id } })).id;
      expect((await h.request(f.expert.cookie, "expert/reviews/" + reviewId + "/draft", {
        expectedVersion: 1, summary: "Synthetic private review summary.", limitations: "Synthetic workflow fixture only.",
        observations: [{ category: "SPEECH", startMs: 100, endMs: 500,
          observation: "Synthetic reading statement.", context: "Synthetic hobbies prompt." }],
      }, "PATCH")).status).toBe(200);
      observationId = (await h.db.client.expertObservation.findFirstOrThrow({ where: { reviewId } })).id;
      if (stage !== "draft") {
        expect((await h.request(f.expert.cookie, "expert/reviews/" + reviewId + "/submit", { expectedVersion: 2 })).status).toBe(200);
        if (stage !== "submitted") {
          expect((await h.request(f.moderator.cookie, "qa/reviews/" + reviewId + "/approve", {
            expectedVersion: 3, claims: [{ type: "INTEREST_READING", observationId,
              context: "Synthetic hobbies prompt.", transcript: "Synthetic: I enjoy reading." }],
          })).status).toBe(200);
          claimId = (await h.db.client.reviewClaim.findFirstOrThrow({ where: { reviewId } })).id;
          if (stage !== "approved") {
            expect((await h.request(f.owner.cookie, "reviews/claims/" + claimId, {
              action: "CONFIRM", expectedRevision: 0,
            }, "PATCH")).status).toBe(200);
            if (stage === "shared") expect((await h.request(f.owner.cookie, "reviews/claims/" + claimId, {
              action: "SHARE", expectedRevision: 1,
            }, "PATCH")).status).toBe(200);
          }
        }
      }
    }
    return { ...f, admin, initPath, reviewId, observationId, claimId, consentVersion: 3 };
  }
  async function restrict(f: Awaited<ReturnType<typeof workflow>>, kind: Restriction) {
    const response = kind === "DELETE"
      ? await h.request(f.owner.cookie, "videos/" + f.videoId, {}, "DELETE")
      : await h.request(f.owner.cookie, "consents/me", { expectedVersion: f.consentVersion,
        consents: [{ purpose: kind, granted: false }] }, "PATCH");
    expect(response.status).toBe(kind === "DELETE" ? 202 : 200);
    return response;
  }
  async function matching(f: Awaited<ReturnType<typeof workflow>>) {
    // Keep previous synthetic fixtures outside this test's candidate set.
    await h.db.client.profile.updateMany({ data: { visibilityEnabled: false } });
    const viewer = await h.account();
    for (const member of [viewer, f.owner]) await h.db.client.profile.create({ data: {
      userId: member.id, birthDate: new Date("1990-01-01T00:00:00Z"), visibilityEnabled: true, relationshipGoal: "long-term",
    } });
    await h.consent(viewer, 0, "PROFILE_MATCHING", true);
    const read = () => h.request(viewer.cookie, "matches/recommendations", undefined, "GET");
    const initial = await read();
    expect(initial.status).toBe(200);
    const body = await initial.json() as { recommendations: { pairId: string; reasons: string[] }[] };
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].reasons).toContain("The member said they enjoy reading.");
    return { viewer, read, reference: body.recommendations[0].pairId };
  }
  return { ...h, media, context, workflow, restrict, matching,
    async close() { for (const spy of spies) spy.mockRestore(); await h.close(); } };
}
export type IntegratedWorkflowHarness = Awaited<ReturnType<typeof integratedWorkflowHarness>>;

/** Hold the first real transaction after its actual work, before COMMIT. The
 * second real request must wait on that backend's domain locks. No result,
 * authorizer, session, SQL mutation or endpoint is replaced by a success mock. */
export async function orderedTransactions<T, U>(h: SecurityMediaHarness, first: () => Promise<T>, second: () => Promise<U>, secondMustBlock = true) {
  let entered!: () => void, release!: () => void, pid = 0;
  const ready = new Promise<void>(r => { entered = r; }), barrier = new Promise<void>(r => { release = r; });
  const original = h.db.client.$transaction.bind(h.db.client) as unknown as (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object,
  ) => Promise<unknown>;
  const spy = jest.spyOn(h.db.client, "$transaction").mockImplementationOnce((async (work: unknown, options?: object) => {
    if (typeof work !== "function") throw Error("Interactive transaction required");
    return original(async tx => {
      const result = await work(tx);
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pid = backend.pid; entered(); await barrier; return result;
    }, { ...options, timeout: 15000 });
  }) as unknown as typeof h.db.client.$transaction);
  const a = first(); let b: Promise<U> | undefined;
  try {
    await Promise.race([ready, a.then(() => { throw Error("First operation returned before the lock barrier"); })]);
    b = second();
    if (secondMustBlock) {
      let blocked = false;
      for (const until = Date.now() + 5000; Date.now() < until;) {
        const waiting = await h.db.client.$queryRaw<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))`;
        if (waiting.length) { blocked = true; break; }
        await new Promise(r => setTimeout(r, 10));
      }
      expect(blocked).toBe(true);
    } else {
      // A queue scanner must not see or acknowledge uncommitted producer work.
      await b;
    }
    release(); return await Promise.all([a, b]) as [T, U];
  } finally { release(); spy.mockRestore(); await Promise.allSettled([a, ...(b ? [b] : [])]); }
}
