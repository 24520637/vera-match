import {
  matchesVideoContainer,
  PrivateStorageService,
} from "./private-storage.service";
import { EnvironmentService } from "../config/environment.service";

describe("Private storage boundaries", () => {
  function signer() {
    const service = new PrivateStorageService({ values: { minio: { endpoint: "http://127.0.0.1:1", bucket: "synthetic-private",
      accessKey: "synthetic", secretKey: "synthetic-only" } } } as EnvironmentService);
    jest.spyOn(service, "assertPrivate").mockResolvedValue(undefined);
    return service;
  }
  test.each([0, -1, 61, 1.5, NaN, Infinity])("rejects invalid playback TTL %s before storage access", async ttl => {
    const service = signer();
    try {
      await expect(service.playbackUrl("opaque", "video/mp4", ttl)).rejects.toThrow("Playback TTL");
      expect(service.assertPrivate).not.toHaveBeenCalled();
    } finally { service.onModuleDestroy(); }
  });
  test("owner default stays 60 seconds and shorter TTL uses the same signer", async () => {
    const service = signer();
    try {
      expect(new URL(await service.playbackUrl("opaque", "video/mp4")).searchParams.get("X-Amz-Expires")).toBe("60");
      expect(new URL(await service.playbackUrl("opaque", "video/mp4", 7)).searchParams.get("X-Amz-Expires")).toBe("7");
    } finally { service.onModuleDestroy(); }
  });
  test("bounded grant reports the exact whole-second SigV4 expiration", async () => {
    const service = signer(), now = new Date("2026-11-18T12:00:00.750Z");
    try {
      const grant = await service.playbackGrant("opaque", "video/mp4", async () => ({ now, expiresAt: new Date("2026-11-18T12:00:09.250Z") }));
      const query = new URL(grant.url).searchParams;
      expect(query.get("X-Amz-Date")).toBe("20261118T120000Z");
      expect(query.get("X-Amz-Expires")).toBe("9");
      expect(grant.expiresAt).toBe("2026-11-18T12:00:09.000Z");
    } finally { service.onModuleDestroy(); }
  });
  test("insufficient safe remaining time fails closed", async () => {
    const service = signer(), now = new Date("2026-11-18T12:00:00.750Z");
    try {
      await expect(service.playbackGrant("opaque", "video/mp4", async () => ({ now, expiresAt: new Date(now.getTime() + 500) }))).rejects.toMatchObject({ status: 503 });
    } finally { service.onModuleDestroy(); }
  });
  test("opaque keys contain no owner or original filename", () => {
    const service = new PrivateStorageService({
      values: {
        minio: {
          endpoint: "http://127.0.0.1:1",
          bucket: "test-private",
          accessKey: "synthetic",
          secretKey: "synthetic-only",
        },
      },
    } as EnvironmentService);
    const keys = new Set(
      Array.from({ length: 100 }, () => service.key("incoming")),
    );
    expect(keys.size).toBe(100);
    for (const key of keys) expect(key).toMatch(/^incoming\/[a-f0-9-]{36}$/);
    service.onModuleDestroy();
  });
  test("rejects text disguised by a video Content-Type", () => {
    expect(matchesVideoContainer(Buffer.from("not a video"), "video/mp4")).toBe(
      false,
    );
    expect(
      matchesVideoContainer(Buffer.from("not a video"), "video/webm"),
    ).toBe(false);
    expect(
      matchesVideoContainer(
        Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
        "video/mp4",
      ),
    ).toBe(true);
  });
  test("storage outages are sanitized", async () => {
    const service = new PrivateStorageService({
      values: {
        minio: {
          endpoint: "http://127.0.0.1:1",
          bucket: "test-private",
          accessKey: "synthetic",
          secretKey: "synthetic-only",
        },
      },
    } as EnvironmentService);
    await expect(service.assertPrivate()).rejects.toMatchObject({
      response: { code: "VIDEO_STORAGE_UNAVAILABLE" },
      status: 503,
    });
    service.onModuleDestroy();
  });
});
