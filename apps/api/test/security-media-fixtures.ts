import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { ConsentPurpose } from "@prisma/client";
import { ConsentPolicyRegistry } from "../src/consent/consent.policy";
import { ExpertApprovalModule } from "../src/expert-admin/expert-approval.module";
import {
  ExpertApprovalRegistry,
  ExpertEvidenceSource,
  ExpertEvidence,
} from "../src/expert-admin/expert-approval.sources";
import {
  ExpertMfaSource,
  ExpertMfaAssurance,
} from "../src/expert-admin/expert-mfa.source";
import { configureIncomingExpiry } from "./video-storage-fixtures";
import { securityHarness } from "./security-regression-fixtures";

/** Synthetic qualification/policies/MFA only, isolated from ordinary runtime.
 * Login, approval, consent, upload, assignment, signing and storage remain real.
 */
export async function securityMediaHarness() {
  const bucket = "vera-security-test-" + randomUUID(),
    h = await securityHarness(bucket);
  const endpoint = new URL(h.values.minio.endpoint);
  if (
    process.env.NODE_ENV !== "test" ||
    !/^vera_auth_test_[a-f0-9]{32}$/.test(h.db.schema) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
    endpoint.port !== "9000" ||
    h.values.minio.bucket !== bucket
  ) {
    await h.close();
    throw Error("Disposable local media fixtures required");
  }
  const records = new Map<string, ExpertEvidence>(),
    proofs = new Map<string, ExpertMfaAssurance>();
  const policyVersion = "synthetic-security-v1",
    training = "synthetic-security-training",
    confidentiality = "synthetic-security-confidentiality";
  // Queues register separate providers. Approval and playback use these instances.
  const approval = h.app.select(ExpertApprovalModule);
  const approvalRegistry = approval.get(ExpertApprovalRegistry, { strict: true });
  const evidenceSource = approval.get(ExpertEvidenceSource, { strict: true });
  const spies = [
    jest
      .spyOn(h.app.get(ConsentPolicyRegistry), "current")
      .mockImplementation((purpose) => ({
        purpose,
        policyVersion,
        locale: "en-test",
        content: "SYNTHETIC SECURITY POLICY " + purpose,
        testOnly: true,
      })),
    jest
      .spyOn(approvalRegistry, "training")
      .mockImplementation((version) =>
        version === training
          ? { version, content: "SYNTHETIC TRAINING" }
          : undefined,
      ),
    jest
      .spyOn(approvalRegistry, "confidentiality")
      .mockImplementation((version) =>
        version === confidentiality
          ? { version, content: "SYNTHETIC CONFIDENTIALITY" }
          : undefined,
      ),
    jest
      .spyOn(evidenceSource, "find")
      .mockImplementation(async (id) => records.get(id)),
    jest
      .spyOn(h.app.get(ExpertMfaSource), "resolve")
      .mockImplementation(async (auth) => proofs.get(auth.sessionId)),
  ];
  const client = new S3Client({
    endpoint: h.values.minio.endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: h.values.minio.accessKey,
      secretAccessKey: h.values.minio.secretKey,
    },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    await configureIncomingExpiry(client, bucket);
  } catch (error) {
    for (const spy of spies) spy.mockRestore();
    client.destroy();
    await h.close();
    throw error;
  }
  type Actor = Awaited<ReturnType<typeof h.account>>;
  async function consent(
    owner: Actor,
    expectedVersion: number,
    purpose: ConsentPurpose,
    granted: boolean,
  ) {
    const response = await h.request(
      owner.cookie,
      "consents/me",
      {
        expectedVersion,
        consents: [{ purpose, granted, ...(granted ? { policyVersion } : {}) }],
      },
      "PATCH",
    );
    expect(response.status).toBe(200);
  }
  async function storageConsent(owner: Actor) {
    await consent(owner, 0, "VIDEO_STORAGE", true);
  }
  async function assign(
    owner: Actor,
    moderator: Actor,
    expert: Actor,
    videoId: string,
    expiresAt: string | null = null,
  ) {
    const response = await h.request(
      moderator.cookie,
      "expert-admin/assignments",
      {
        videoId,
        expertId: expert.id,
        expectedCredentialRevision: 1,
        dueAt: null,
        expiresAt,
      },
    );
    expect(response.status).toBe(201);
    return ((await response.json()) as { assignment: { id: string } })
      .assignment.id;
  }
  async function fixture(expiresAfterMs?: number) {
    const owner = await h.account(),
      moderator = await h.account("MODERATOR"),
      expert = await h.account("EXPERT");
    for (const actor of [moderator, expert])
      proofs.set(actor.sessionId, {
        userId: actor.id,
        sessionId: actor.sessionId,
        testOnly: true,
        expiresAt: new Date(Date.now() + 600000),
      });
    const trainingEvidenceId = randomUUID(),
      confidentialityEvidenceId = randomUUID();
    for (const [id, kind, version] of [
      [trainingEvidenceId, "TRAINING_COMPLETION", training],
      [
        confidentialityEvidenceId,
        "CONFIDENTIALITY_ACCEPTANCE",
        confidentiality,
      ],
    ] as const)
      records.set(id, {
        id,
        userId: expert.id,
        kind,
        version,
        content: "SYNTHETIC " + kind,
        recordedAt: new Date(Date.now() - 1000),
        validUntil: null,
      });
    expect(
      (
        await h.request(
          moderator.cookie,
          "expert-admin/experts/" + expert.id + "/approvals",
          {
            expectedRevision: 0,
            trainingVersion: training,
            policyVersion: confidentiality,
            trainingEvidenceId,
            confidentialityEvidenceId,
            expiresAt: null,
          },
        )
      ).status,
    ).toBe(201);
    await storageConsent(owner);
    await consent(owner, 1, "EXPERT_VIDEO_REVIEW", true);
    const upload = await h.request(owner.cookie, "videos/upload-intent", {
      mimeType: "video/mp4",
      sizeBytes: 12,
    });
    expect(upload.status).toBe(201);
    const intent = (await upload.json()) as { id: string; uploadUrl: string };
    const bytes = Buffer.from([
      0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109,
    ]);
    expect(
      (
        await fetch(intent.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "video/mp4" },
          body: bytes,
        })
      ).status,
    ).toBe(200);
    expect(
      (await h.request(owner.cookie, "videos/" + intent.id + "/confirm"))
        .status,
    ).toBe(201);
    const expiresAt = expiresAfterMs
      ? new Date(Date.now() + expiresAfterMs).toISOString()
      : null;
    const id = await assign(owner, moderator, expert, intent.id, expiresAt);
    return { owner, moderator, expert, videoId: intent.id, id, expiresAt };
  }
  return {
    ...h,
    approvalRegistry,
    evidenceSource,
    bucket,
    records,
    proofs,
    fixture,
    consent,
    storageConsent,
    assign,
    async finalObjectAbsent(videoId: string) {
      const video = await h.db.client.video.findUniqueOrThrow({
        where: { id: videoId },
      });
      if (video.bucket !== bucket)
        throw Error("Foreign fixture bucket refused");
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: video.objectKey }),
        );
        return false;
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        )
          return true;
        throw Error("Fixture storage HEAD unavailable");
      }
    },
    play(cookie: string, id: string) {
      return h.request(cookie, "expert/assignments/" + id + "/playback");
    },
    async close() {
      try {
        await h.close();
      } finally {
        for (const spy of spies) spy.mockRestore();
        try {
          if (!/^vera-security-test-[a-f0-9-]{36}$/.test(bucket))
            throw Error("Unsafe storage fixture cleanup");
          const objects = await client.send(
            new ListObjectsV2Command({ Bucket: bucket }),
          );
          for (const object of objects.Contents ?? [])
            await client.send(
              new DeleteObjectCommand({ Bucket: bucket, Key: object.Key! }),
            );
          await client.send(new DeleteBucketCommand({ Bucket: bucket }));
        } finally {
          client.destroy();
        }
      }
    },
  };
}
export type SecurityMediaHarness = Awaited<
  ReturnType<typeof securityMediaHarness>
>;
