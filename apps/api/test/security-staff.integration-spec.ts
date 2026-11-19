import { SessionService } from "../src/auth/session.service";
import { AssignmentCancellationService } from "../src/assignment-cancellation/assignment-cancellation.service";
import { PrivateStorageService } from "../src/video/private-storage.service";
import {
  securityMediaHarness,
  SecurityMediaHarness,
} from "./security-media-fixtures";

describe("C086 staff authorization and transaction release gates", () => {
  let h: SecurityMediaHarness;
  beforeAll(async () => {
    h = await securityMediaHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  test.each(["development", "production"] as const)(
    "%s never opens private access from role or real-looking/synthetic proof flags",
    async (nodeEnv) => {
      const f = await h.fixture(),
        admin = await h.account("ADMIN");
      expect((await h.play(f.expert.cookie, f.id)).status).toBe(200);
      const sign = jest.spyOn(
        h.app.get(PrivateStorageService),
        "playbackGrant",
      );
      const previous = h.values.nodeEnv;
      Object.assign(h.values, { nodeEnv });
      try {
        for (const testOnly of [true, false]) {
          h.proofs.set(f.expert.sessionId, {
            userId: f.expert.id,
            sessionId: f.expert.sessionId,
            expiresAt: new Date(Date.now() + 600000),
            testOnly,
          });
          for (const actor of [f.expert, f.moderator, f.owner, admin]) {
            const response = await h.play(actor.cookie, f.id);
            expect(response.status).toBe(403);
            expect(
              JSON.stringify(await response.json()).includes("X-Amz-"),
            ).toBe(false);
          }
        }
        expect(
          (
            await h.request(
              f.moderator.cookie,
              "moderation/reports",
              undefined,
              "GET",
            )
          ).status,
        ).toBe(403);
        expect(sign).not.toHaveBeenCalled();
        // Restricting access remains possible without approving a new real policy.
        await h.consent(f.owner, 2, "EXPERT_VIDEO_REVIEW", false);
        const ledger = await h.db.client.consentLedger.findUniqueOrThrow({
          where: { userId: f.owner.id },
        });
        const task = await h.db.client.consentWithdrawalTask.findFirstOrThrow({
          where: {
            subjectId: ledger.subjectId,
            purpose: "EXPERT_VIDEO_REVIEW",
            version: 3n,
          },
        });
        expect(
          await h.app
            .get(AssignmentCancellationService)
            .processWithdrawal(task.id),
        ).toMatchObject({ completed: true, cancelled: 1 });
      } finally {
        Object.assign(h.values, { nodeEnv: previous });
        sign.mockRestore();
      }
      // This proves ordinary-runtime denial, NOT real MFA or production-data acceptance.
    },
  );
  test("a new login cannot reuse another session's MFA proof, and one-session logout leaves the other independently authorized session", async () => {
    const f = await h.fixture(),
      second = await h.login(f.expert.email, f.expert.password);
    const sign = jest.spyOn(h.app.get(PrivateStorageService), "playbackGrant");
    try {
      for (const proof of [
        undefined,
        {
          userId: f.expert.id,
          sessionId: f.expert.sessionId,
          expiresAt: new Date(Date.now() + 600000),
          testOnly: true,
        },
        {
          userId: f.owner.id,
          sessionId: second.sessionId,
          expiresAt: new Date(Date.now() + 600000),
          testOnly: true,
        },
        {
          userId: f.expert.id,
          sessionId: second.sessionId,
          expiresAt: new Date(0),
          testOnly: true,
        },
      ]) {
        if (proof) h.proofs.set(second.sessionId, proof);
        else h.proofs.delete(second.sessionId);
        expect(
          (
            await h.request(
              second.cookie,
              "expert/assignments/" + f.id + "/playback",
              {},
              "POST",
              { "X-MFA-Verified": "true", "X-Session-Id": f.expert.sessionId },
            )
          ).status,
        ).toBe(403);
      }
      expect(sign).not.toHaveBeenCalled();
      h.proofs.set(second.sessionId, {
        userId: f.expert.id,
        sessionId: second.sessionId,
        expiresAt: new Date(Date.now() + 600000),
        testOnly: true,
      });
      expect((await h.play(second.cookie, f.id)).status).toBe(200);
      expect((await h.request(f.expert.cookie, "auth/logout")).status).toBe(
        204,
      );
      expect((await h.play(f.expert.cookie, f.id)).status).toBe(401);
      expect((await h.play(second.cookie, f.id)).status).toBe(200);
      expect(sign).toHaveBeenCalledTimes(2);
    } finally {
      sign.mockRestore();
    }
  });
  test("C034 rechecks role after a real session lookup becomes stale", async () => {
    const f = await h.fixture(),
      sessions = h.app.get(SessionService),
      resolve = sessions.resolve.bind(sessions);
    let changed = false;
    const source = jest
      .spyOn(sessions, "resolve")
      .mockImplementation(async (token) => {
        const context = await resolve(token);
        if (context?.user.id === f.expert.id && !changed) {
          changed = true;
          await h.db.client.user.update({
            where: { id: f.expert.id },
            data: { role: "MEMBER" },
          });
        }
        return context; // Actual pre-change server context, not a fake auth success.
      });
    const sign = jest.spyOn(h.app.get(PrivateStorageService), "playbackGrant");
    try {
      expect((await h.play(f.expert.cookie, f.id)).status).toBe(403);
      expect(changed).toBe(true);
      expect(sign).not.toHaveBeenCalled();
      expect(
        await h.db.client.auditLog.count({
          where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: f.id },
        }),
      ).toBe(0);
    } finally {
      source.mockRestore();
      sign.mockRestore();
    }
  });
  test("a deferred database failure after real signing never publishes the prepared URL or commits its success audit", async () => {
    const f = await h.fixture(),
      sign = jest.spyOn(h.app.get(PrivateStorageService), "playbackGrant");
    await h.db.client
      .$executeRawUnsafe(`CREATE FUNCTION t15_deferred_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='EXPERT_PLAYBACK_ISSUED' THEN RAISE EXCEPTION 'synthetic private commit detail'; END IF; RETURN NULL; END $$`);
    await h.db.client.$executeRawUnsafe(
      'CREATE CONSTRAINT TRIGGER t15_deferred_audit_fail AFTER INSERT ON "AuditLog" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION t15_deferred_audit_fail()',
    );
    try {
      const response = await h.play(f.expert.cookie, f.id);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "EXPERT_ACCESS_UNAVAILABLE",
      });
      expect(sign).toHaveBeenCalledTimes(1);
      expect(
        await h.db.client.auditLog.count({
          where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: f.id },
        }),
      ).toBe(0);
      expect(
        await h.db.client.expertAssignment.findUnique({ where: { id: f.id } }),
      ).toMatchObject({ status: "ASSIGNED", revision: 0n });
    } finally {
      await h.db.client.$executeRawUnsafe(
        'DROP TRIGGER t15_deferred_audit_fail ON "AuditLog"',
      );
      await h.db.client.$executeRawUnsafe(
        "DROP FUNCTION t15_deferred_audit_fail()",
      );
      sign.mockRestore();
    }
    expect((await h.play(f.expert.cookie, f.id)).status).toBe(200);
  });
});
