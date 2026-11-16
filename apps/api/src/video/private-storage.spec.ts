import {
  matchesVideoContainer,
  PrivateStorageService,
} from "./private-storage.service";
import { EnvironmentService } from "../config/environment.service";

describe("Private storage boundaries", () => {
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
