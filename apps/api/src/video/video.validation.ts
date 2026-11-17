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

export function parseVideoCursor(
  value: unknown,
): { createdAt: Date; id: string } | undefined {
  if (value === undefined) return undefined;
  const invalid = (): never => {
    throw new BadRequestException({
      code: "INVALID_CURSOR",
      message:
        "Use the next cursor returned by your video list, or refresh the list.",
    });
  };
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    invalid();
  let tuple: unknown;
  try {
    const bytes = Buffer.from(value as string, "base64url");
    if (bytes.toString("base64url") !== value) invalid();
    tuple = JSON.parse(bytes.toString("utf8"));
  } catch {
    invalid();
  }
  if (
    !Array.isArray(tuple) ||
    tuple.length !== 2 ||
    typeof tuple[0] !== "string" ||
    typeof tuple[1] !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(tuple[1])
  )
    invalid();
  const [timestamp, id] = tuple as [string, string];
  const createdAt = new Date(timestamp);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    createdAt.toISOString() !== timestamp
  )
    invalid();
  return { createdAt, id };
}

export function encodeVideoCursor(video: {
  createdAt: Date;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify([video.createdAt.toISOString(), video.id]),
    "utf8",
  ).toString("base64url");
}
