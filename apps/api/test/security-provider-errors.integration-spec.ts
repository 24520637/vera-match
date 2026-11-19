import { ServiceUnavailableException } from "@nestjs/common";
import { ExpertMfaSource } from "../src/expert-admin/expert-mfa.source";
import {
  ExpertApprovalRegistry,
  ExpertEvidenceSource,
} from "../src/expert-admin/expert-approval.sources";
import { PrivateStorageService } from "../src/video/private-storage.service";
import {
  securityMediaHarness,
  SecurityMediaHarness,
} from "./security-media-fixtures";

describe("C087 upstream provider error privacy regression", () => {
  let h: SecurityMediaHarness;
  beforeAll(async () => {
    h = await securityMediaHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  test.each(["mfa", "evidence", "registry"] as const)(
    "%s HttpException cannot become a public response payload",
    async (kind) => {
      const f = await h.fixture();
      const failure = new ServiceUnavailableException({
        code: "PRIVATE_PROVIDER_CODE",
        message: "PRIVATE upstream detail",
        objectKey: "PRIVATE_MEDIA_KEY",
      });
      // Provider functions are test-only spies installed by the isolated fixture.
      if (kind === "mfa")
        (h.app.get(ExpertMfaSource).resolve as jest.Mock).mockRejectedValueOnce(
          failure,
        );
      if (kind === "evidence")
        (
          h.app.get(ExpertEvidenceSource).find as jest.Mock
        ).mockRejectedValueOnce(failure);
      if (kind === "registry")
        (
          h.app.get(ExpertApprovalRegistry).training as jest.Mock
        ).mockImplementationOnce(() => {
          throw failure;
        });
      const sign = jest.spyOn(
        h.app.get(PrivateStorageService),
        "playbackGrant",
      );
      try {
        const response = await h.play(f.expert.cookie, f.id);
        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body).toEqual({
          code: "EXPERT_ACCESS_UNAVAILABLE",
          message: "Expert access could not be safely confirmed.",
        });
        expect(sign).not.toHaveBeenCalled();
        expect(
          await h.db.client.auditLog.count({
            where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: f.id },
          }),
        ).toBe(0);
        expect((await h.play(f.expert.cookie, f.id)).status).toBe(200);
      } finally {
        sign.mockRestore();
      }
    },
  );
});
