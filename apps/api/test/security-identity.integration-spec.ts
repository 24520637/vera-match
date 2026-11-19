import { randomBytes, randomUUID } from "node:crypto";
import { hashSessionToken } from "../src/auth/session-token";
import {
  securityHarness,
  SecurityHarness,
} from "./security-regression-fixtures";

const reads = [
  "auth/me",
  "profile/me",
  "preferences/me",
  "questionnaire/me",
  "consents/me",
  "videos/me",
  "blocks/me",
];
describe("C083 cross-feature identity and session regression", () => {
  let h: SecurityHarness;
  beforeAll(async () => {
    h = await securityHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });

  test.each([
    "missing",
    "altered",
    "expired",
    "revoked",
    "suspended",
    "deleted",
    "unverified",
  ])(
    "%s identity is rejected consistently across every implemented member read",
    async (state) => {
      const actor = await h.account();
      let cookie = actor.cookie;
      if (state === "missing") cookie = "";
      if (state === "altered")
        cookie =
          h.values.session.cookieName +
          "=" +
          randomBytes(32).toString("base64url");
      if (state === "expired")
        await h.db.client.session.update({
          where: { id: actor.sessionId },
          data: { expiresAt: new Date(0) },
        });
      if (state === "revoked")
        await h.db.client.session.update({
          where: { id: actor.sessionId },
          data: { revokedAt: new Date() },
        });
      if (state === "suspended" || state === "deleted")
        await h.db.client.user.update({
          where: { id: actor.id },
          data: { status: state === "deleted" ? "DELETED" : "SUSPENDED" },
        });
      if (state === "unverified")
        await h.db.client.user.update({
          where: { id: actor.id },
          data: { emailVerifiedAt: null },
        });
      for (const path of reads)
        expect((await h.request(cookie, path, undefined, "GET")).status).toBe(
          401,
        );
      // These are account-state fixtures, not an implemented deletion endpoint.
    },
  );
  test("login ignores a preselected cookie and a foreign user's session; logout-all preserves the foreign identity", async () => {
    const victim = await h.account(),
      attacker = await h.account();
    const chosen = randomBytes(32).toString("base64url");
    const fresh = await h.login(
      victim.email,
      victim.password,
      h.values.session.cookieName + "=" + chosen,
    );
    const other = await h.login(victim.email, victim.password, attacker.cookie);
    expect(
      fresh.token === chosen ||
        other.token === attacker.token ||
        other.token === fresh.token,
    ).toBe(false);
    expect(
      await h.db.client.session.findUnique({
        where: { tokenHash: hashSessionToken(chosen) },
      }),
    ).toBeNull();
    expect((await h.request(victim.cookie, "auth/logout-all")).status).toBe(
      204,
    );
    for (const cookie of [victim.cookie, fresh.cookie, other.cookie])
      for (const path of reads)
        expect((await h.request(cookie, path, undefined, "GET")).status).toBe(
          401,
        );
    expect(
      (await h.request(attacker.cookie, "auth/me", undefined, "GET")).status,
    ).toBe(200);
  });
  test("forged owners never change another member's profile, consent, video or block edge", async () => {
    const victim = await h.account(),
      attacker = await h.account(),
      target = await h.account();
    expect(
      (
        await h.request(
          victim.cookie,
          "profile/me",
          { expectedRevision: 0, bio: "Synthetic private draft" },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    const before = await h.db.client.profile.findUniqueOrThrow({
      where: { userId: victim.id },
    });
    const video = await h.db.client.video.create({
      data: {
        ownerId: victim.id,
        bucket: "synthetic-unread",
        objectKey: randomUUID(),
        mimeType: "video/mp4",
        status: "READY",
      },
    });
    for (const path of [
      "profile/me",
      "preferences/me",
      "questionnaire/me",
      "consents/me",
      "videos/me",
    ])
      expect(
        (
          await h.request(
            attacker.cookie,
            path + "?userId=" + victim.id,
            undefined,
            "GET",
          )
        ).status,
      ).toBe(400);
    for (const body of [
      { expectedRevision: 1, userId: victim.id, bio: "forged" },
      { expectedRevision: 1, role: "ADMIN" },
    ])
      expect(
        (await h.request(attacker.cookie, "profile/me", body, "PATCH")).status,
      ).toBe(400);
    expect(
      (
        await h.request(
          attacker.cookie,
          "consents/me",
          { expectedVersion: 0, userId: victim.id, consents: [] },
          "PATCH",
        )
      ).status,
    ).toBe(400);
    for (const suffix of ["/confirm", "/playback", ""])
      expect(
        (
          await h.request(
            attacker.cookie,
            "videos/" + video.id + suffix,
            {},
            suffix ? "POST" : "DELETE",
          )
        ).status,
      ).toBe(suffix ? 403 : 404);
    expect(
      (await h.request(victim.cookie, "blocks", { targetUserId: target.id }))
        .status,
    ).toBe(204);
    expect(
      (await h.request(attacker.cookie, "blocks/" + target.id, {}, "DELETE"))
        .status,
    ).toBe(204);
    expect(
      await h.db.client.block.count({
        where: { blockerId: victim.id, blockedId: target.id },
      }),
    ).toBe(1);
    expect(
      await h.db.client.profile.findUnique({ where: { userId: victim.id } }),
    ).toEqual(before);
    expect(
      await h.db.client.video.findUnique({ where: { id: video.id } }),
    ).toMatchObject({ status: "READY", deletedAt: null });
    expect(
      await h.db.client.consentLedger.findUnique({
        where: { userId: victim.id },
      }),
    ).toBeNull();
  });
  test("a real Mailpit password reset revokes sessions across features, without revoking an unrelated user", async () => {
    const { readResetEmail, clearTestEmails } =
      await import("./mailpit-fixtures");
    const victim = await h.account(),
      second = await h.login(victim.email, victim.password),
      other = await h.account();
    try {
      expect(
        (await h.request("", "auth/forgot-password", { email: victim.email }))
          .status,
      ).toBe(202);
      const mail = await readResetEmail(victim.email);
      expect(
        (
          await h.request("", "auth/reset-password", {
            token: mail.token,
            newPassword: "synthetic-replaced-security-password",
          })
        ).status,
      ).toBe(200);
      for (const cookie of [victim.cookie, second.cookie])
        for (const path of reads)
          expect((await h.request(cookie, path, undefined, "GET")).status).toBe(
            401,
          );
      expect(
        (await h.request(other.cookie, "auth/me", undefined, "GET")).status,
      ).toBe(200);
      expect(
        (
          await h.request("", "auth/reset-password", {
            token: mail.token,
            newPassword: "synthetic-replay-password",
          })
        ).status,
      ).toBe(400);
    } finally {
      await clearTestEmails(victim.email);
    }
  });
  test("role demotion is read from the database, not stale cookies or forged headers", async () => {
    const actor = await h.account("MODERATOR");
    await h.db.client.user.update({
      where: { id: actor.id },
      data: { role: "MEMBER" },
    });
    const me = await h.request(actor.cookie, "auth/me", undefined, "GET");
    expect(await me.json()).toMatchObject({ role: "MEMBER" });
    expect(
      (
        await h.request(actor.cookie, "moderation/reports", undefined, "GET", {
          "X-User-Role": "MODERATOR",
          "X-User-Id": actor.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.request(
          actor.cookie,
          "expert/assignments/unknown/playback",
          {},
          "POST",
          { "X-User-Role": "EXPERT" },
        )
      ).status,
    ).toBe(403);
    // No merged role/provisioning mutation API exists: promotion-time rotation is BLOCKED, not simulated as complete.
  });
});
