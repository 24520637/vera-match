import { Injectable } from "@nestjs/common";
import { ConsentAccessService } from "../consent/consent-access.service";
import {
  PrivateStorageService,
  UPLOAD_TTL_SECONDS,
} from "./private-storage.service";
import { uploadInput } from "./video.validation";

@Injectable()
export class VideoService {
  constructor(
    private readonly consent: ConsentAccessService,
    private readonly storage: PrivateStorageService,
  ) {}
  intent(ownerId: string, input: unknown) {
    const data = uploadInput(input);
    return this.consent.withAuthorizedConsent(
      ownerId,
      "VIDEO_STORAGE",
      async (tx) => {
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
