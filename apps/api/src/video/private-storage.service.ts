import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketPolicyCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { EnvironmentService } from "../config/environment.service";

export const PLAYBACK_TTL_SECONDS = 60;
export const UPLOAD_TTL_SECONDS = 300;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const VIDEO_TYPES = ["video/mp4", "video/webm"] as const;

/** Server-only adapter. URLs are bearer credentials and must never be logged. */
@Injectable()
export class PrivateStorageService {
  readonly bucket: string;
  private readonly client: S3Client;
  constructor(environment: EnvironmentService) {
    const config = environment.values.minio;
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      maxAttempts: 1,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      requestHandler: { connectionTimeout: 1500, requestTimeout: 3000 },
    });
  }
  key(prefix: "incoming" | "video") {
    return `${prefix}/${randomUUID()}`;
  }
  private unavailable(): never {
    throw new ServiceUnavailableException({
      code: "VIDEO_STORAGE_UNAVAILABLE",
      message: "Private video storage is unavailable. Try again later.",
    });
  }
  private async safe<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch {
      return this.unavailable();
    }
  }
  async assertPrivate() {
    return this.safe(async () => {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      // This application intentionally requires NO bucket policy, rather than trying
      // to decide whether an arbitrary policy grants anonymous object access.
      try {
        await this.client.send(
          new GetBucketPolicyCommand({ Bucket: this.bucket }),
        );
      } catch (error) {
        if ((error as { name?: string }).name === "NoSuchBucketPolicy") return;
        throw error;
      }
      throw new Error(
        "Bucket policies are not allowed for private video storage",
      );
    });
  }
  async uploadUrl(key: string, mimeType: string, sizeBytes: number) {
    await this.assertPrivate();
    return this.safe(() =>
      getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: mimeType,
          ContentLength: sizeBytes,
        }),
        {
          expiresIn: UPLOAD_TTL_SECONDS,
          signableHeaders: new Set(["content-type", "content-length"]),
        },
      ),
    );
  }
  async inspect(key: string) {
    await this.assertPrivate();
    return this.safe(async () => {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: "bytes=0-4095",
          IfMatch: head.ETag,
        }),
      );
      return {
        size: head.ContentLength,
        mime: head.ContentType,
        etag: head.ETag,
        prefix: await body.Body!.transformToByteArray(),
      };
    });
  }
  async promote(
    source: string,
    target: string,
    etag: string,
    mimeType: string,
  ) {
    await this.safe(() =>
      this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: target,
          CopySource: `${this.bucket}/${source}`,
          CopySourceIfMatch: etag,
          CacheControl: "private, no-store",
          MetadataDirective: "REPLACE",
          ContentType: mimeType,
        }),
      ),
    );
  }
  async playbackUrl(key: string, mimeType: string) {
    await this.assertPrivate();
    return this.safe(() =>
      getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ResponseContentType: mimeType,
          ResponseCacheControl: "private, no-store",
          ResponseContentDisposition: "inline",
        }),
        { expiresIn: PLAYBACK_TTL_SECONDS },
      ),
    );
  }
  async remove(key: string) {
    await this.safe(() =>
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
  }
  onModuleDestroy() {
    this.client.destroy();
  }
}

/** Container signature validation; does not claim malware or semantic analysis. */
export function matchesVideoContainer(
  bytes: Uint8Array,
  mime: string,
): boolean {
  if (mime === "video/mp4")
    return (
      bytes.length >= 12 &&
      Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp"
    );
  return (
    mime === "video/webm" &&
    bytes.length >= 4 &&
    Buffer.from(bytes.subarray(0, 4)).equals(
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    ) &&
    Buffer.from(bytes).includes(Buffer.from("webm"))
  );
}
