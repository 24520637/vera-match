import { Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { PrivateStorageService } from "./private-storage.service";
import { VideoCleanupService } from "./video-cleanup.service";

describe("Video cleanup scheduler observability", () => {
  let worker: VideoCleanupService;
  const sensitive = new Error(
    "private-object-key https://storage.invalid/?X-Amz-Signature=secret account@example.invalid",
  );
  let prisma: {
    $queryRaw: jest.Mock;
    video: { findMany: jest.Mock };
    videoCleanupTask: { findMany: jest.Mock; updateMany: jest.Mock };
  };
  let error: jest.SpyInstance, log: jest.SpyInstance, warn: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    error = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    log = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      video: { findMany: jest.fn().mockResolvedValue([]) },
      videoCleanupTask: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    worker = new VideoCleanupService(
      prisma as unknown as PrismaService,
      {
        remove: jest.fn().mockRejectedValue(sensitive),
        bucket: "private-test",
      } as unknown as PrivateStorageService,
      { values: { nodeEnv: "development" } } as EnvironmentService,
    );
  });
  afterEach(async () => {
    await worker.onModuleDestroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  test("scheduled scan failures are redacted and the next tick can recover", async () => {
    prisma.$queryRaw.mockRejectedValueOnce(sensitive);
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(15000);
    expect(error.mock.calls).toEqual([["VIDEO_CLEANUP_SCAN_FAILED"]]);
    expect(log).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(15000);
    expect(log.mock.calls).toEqual([["VIDEO_CLEANUP_SCAN_RECOVERED"]]);
    expect(prisma.videoCleanupTask.findMany).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(15000);
    expect(log).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify([...error.mock.calls, ...log.mock.calls]),
    ).not.toMatch(/private-object|Signature|account@/);
  });
  test("manual callers still receive failure and shutdown consumes an already reported failure", async () => {
    let reject!: (error: Error) => void;
    prisma.$queryRaw.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const run = worker.runOnce();
    expect(worker.runOnce()).toBe(run);
    const result = expect(run).rejects.toBe(sensitive);
    const stopping = worker.onModuleDestroy();
    reject(sensitive);
    await result;
    await expect(stopping).resolves.toBeUndefined();
    expect(error.mock.calls).toEqual([["VIDEO_CLEANUP_SCAN_FAILED"]]);
  });
  test("a persisted per-object retry emits only a stable code", async () => {
    prisma.videoCleanupTask.findMany.mockResolvedValueOnce([
      {
        id: "sensitive-task-id",
        status: "PENDING",
        attempts: 0,
        bucket: "private-test",
        objectKey: "private-object-key",
        removeFinal: true,
        uploadKey: null,
      },
    ]);
    await worker.runOnce();
    expect(prisma.videoCleanupTask.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          lastErrorCode: "STORAGE_CLEANUP_FAILED",
        }),
      }),
    );
    expect(warn.mock.calls).toEqual([["VIDEO_CLEANUP_RETRY_SCHEDULED"]]);
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
