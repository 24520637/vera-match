import { BadRequestException } from "@nestjs/common";
import { MAX_VIDEO_BYTES, VIDEO_TYPES } from "./private-storage.service";

export function uploadInput(input: unknown): {
  mimeType: string;
  sizeBytes: number;
} {
  const body = input as Record<string, unknown> | null;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !["mimeType", "sizeBytes"].includes(key)) ||
    !VIDEO_TYPES.includes(body.mimeType as (typeof VIDEO_TYPES)[number]) ||
    !Number.isSafeInteger(body.sizeBytes) ||
    (body.sizeBytes as number) < 12 ||
    (body.sizeBytes as number) > MAX_VIDEO_BYTES
  ) {
    throw new BadRequestException({
      code: "INVALID_VIDEO",
      message: "Choose an MP4 or WebM video between 12 bytes and 100 MiB.",
    });
  }
  return {
    mimeType: body.mimeType as string,
    sizeBytes: body.sizeBytes as number,
  };
}
