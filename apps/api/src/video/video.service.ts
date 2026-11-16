import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConsentAccessService } from "../consent/consent-access.service";
import {
  PrivateStorageService,
  UPLOAD_TTL_SECONDS,
  matchesVideoContainer,
} from "./private-storage.service";
import { uploadInput } from "./video.validation";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "@prisma/client";
import {
  consentStorage,
  requireConsentMember,
} from "../consent/consent.service";

@Injectable()
export class VideoService {
  private async requireGeneration(
    tx: Prisma.TransactionClient,
    ownerId: string,
    version: bigint | null,
  ) {
    const ledger = await tx.consentLedger.findUnique({
      where: { userId: ownerId },
    });
    if (
      version === null ||
      !ledger ||
      (await tx.consentWithdrawalTask.count({
        where: {
          subjectId: ledger.subjectId,
          purpose: "VIDEO_STORAGE",
          version: { gt: version },
        },
      }))
    )
      throw new ConflictException({
        code: "VIDEO_WITHDRAWN",
        message:
          "Consent was withdrawn for this video. Upload a new video after granting consent again.",
      });
  }
  remove(ownerId: string, id: string) {
    // Withdrawal must never prevent an owner from deleting their own video.
    return consentStorage(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
        await requireConsentMember(tx, ownerId);
        const video = await tx.video.findFirst({ where: { id, ownerId } });
        if (!video)
          throw new NotFoundException({
            code: "VIDEO_NOT_FOUND",
            message: "Video not found.",
          });
        if (video.status !== "DELETED") {
          await tx.video.update({
            where: { id },
            data: { status: "DELETED", deletedAt: new Date() },
          });
          await tx.auditLog.create({
            data: {
              actorId: ownerId,
              action: "VIDEO_DELETE_REQUESTED",
              subjectType: "Video",
              subjectId: video.id,
            },
          });
        }
        await tx.videoCleanupTask.upsert({
          where: { videoId: id },
          create: {
            videoId: id,
            bucket: video.bucket,
            objectKey: video.objectKey,
            uploadKey: video.uploadKey,
            uploadExpiresAt: video.uploadExpiresAt,
          },
          update: {
            removeFinal: true,
            status: "PENDING",
            completedAt: null,
            nextAttemptAt: new Date(),
          },
        });
        return { id, status: "DELETED", cleanup: "PENDING" };
      }),
    );
  }
  list(ownerId: string) {
    return consentStorage(() =>
      this.prisma.$transaction(async (tx) => {
        await requireConsentMember(tx, ownerId);
        return {
          videos: await tx.video.findMany({
            where: { ownerId },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: {
              id: true,
              status: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
              deletedAt: true,
              cleanupCompletedAt: true,
            },
          }),
        };
      }),
    );
  }
  playback(ownerId: string, id: string) {
    return this.consent.withAuthorizedConsent(
      ownerId,
      "VIDEO_STORAGE",
      async (tx) => {
        const video = await tx.video.findFirst({
          where: { id, ownerId, status: "READY", deletedAt: null },
        });
        if (!video || video.bucket !== this.storage.bucket)
          throw new NotFoundException({
            code: "VIDEO_NOT_FOUND",
            message: "Video not found.",
          });
        await this.requireGeneration(tx, ownerId, video.storageConsentVersion);
        const url = await this.storage.playbackUrl(
          video.objectKey,
          video.mimeType,
        );
        await tx.auditLog.create({
          data: {
            actorId: ownerId,
            action: "VIDEO_PLAYBACK_ISSUED",
            subjectType: "Video",
            subjectId: video.id,
          },
        });
        return {
          id,
          url,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        };
      },
    );
  }
  confirm(ownerId: string, id: string) {
    return this.consent.withAuthorizedConsent(
      ownerId,
      "VIDEO_STORAGE",
      async (tx) => {
        const video = await tx.video.findFirst({ where: { id, ownerId } });
        if (!video)
          throw new NotFoundException({
            code: "VIDEO_NOT_FOUND",
            message: "Video not found.",
          });
        await this.requireGeneration(tx, ownerId, video.storageConsentVersion);
        if (video.status === "READY" && !video.deletedAt)
          return { id, status: "READY" as const };
        if (
          video.status !== "UPLOADING" ||
          video.deletedAt ||
          !video.uploadKey ||
          !video.uploadExpiresAt ||
          video.uploadExpiresAt <= new Date()
        )
          throw new ConflictException({
            code: "UPLOAD_EXPIRED",
            message: "This upload is no longer available. Start a new upload.",
          });
        const object = await this.storage.inspect(video.uploadKey);
        if (
          video.bucket !== this.storage.bucket ||
          object.size !== video.sizeBytes ||
          object.mime !== video.mimeType ||
          !object.etag ||
          !matchesVideoContainer(object.prefix, video.mimeType)
        )
          throw new ConflictException({
            code: "UPLOAD_MISMATCH",
            message: "Uploaded video does not match the upload request.",
          });
        // Never serve the writable incoming key. Conditional copy binds the checked
        // object to the immutable playback key; all owner operations hold User lock.
        await this.storage.promote(
          video.uploadKey,
          video.objectKey,
          object.etag,
          video.mimeType,
        );
        await tx.video.update({ where: { id }, data: { status: "READY" } });
        await tx.auditLog.create({
          data: {
            actorId: ownerId,
            action: "VIDEO_UPLOAD_CONFIRMED",
            subjectType: "Video",
            subjectId: video.id,
          },
        });
        return { id, status: "READY" as const };
      },
    );
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentAccessService,
    private readonly storage: PrivateStorageService,
  ) {}
  intent(ownerId: string, input: unknown) {
    const data = uploadInput(input);
    return this.consent.withAuthorizedConsent(
      ownerId,
      "VIDEO_STORAGE",
      async (tx, version) => {
        const uploadKey = this.storage.key("incoming");
        const uploadExpiresAt = new Date(
          Date.now() + UPLOAD_TTL_SECONDS * 1000,
        );
        // Both the durable intent and URL issuance serialize with withdrawal.
        const uploadUrl = await this.storage.uploadUrl(
          uploadKey,
          data.mimeType,
          data.sizeBytes,
        );
        const video = await tx.video.create({
          data: {
            ...data,
            ownerId,
            bucket: this.storage.bucket,
            objectKey: this.storage.key("video"),
            uploadKey,
            uploadExpiresAt,
            storageConsentVersion: version,
          },
        });
        return {
          id: video.id,
          status: video.status,
          uploadUrl,
          expiresAt: uploadExpiresAt.toISOString(),
          headers: { "Content-Type": data.mimeType },
        };
      },
    );
  }
}
