import { Logger } from "@nestjs/common";
import { AssignmentCancellationWorker } from "./assignment-cancellation.worker";
import { AssignmentCancellationService } from "./assignment-cancellation.service";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
describe("C051 worker observation boundary", () => {
  const empty = [
    { lane: "withdrawal", pending: 0, oldestSeconds: 0 },
    { lane: "deleted-video", pending: 0, oldestSeconds: 0 },
  ];
  const heartbeat = {
    code: "ASSIGNMENT_CANCELLATION_HEARTBEAT",
    withdrawalPending: 0,
    withdrawalOldestSeconds: 0,
    deletedVideoPending: 0,
    deletedVideoOldestSeconds: 0,
  };
  afterEach(() => jest.restoreAllMocks());
  it("reports failed scans without private error payloads, then reports recovery", async () => {
    const error = new Error("PRIVATE SQL credentials and signed URL");
    const query = jest.fn().mockRejectedValueOnce(error).mockResolvedValue([]);
    const prisma = {
      $transaction: query,
      $queryRaw: jest.fn().mockResolvedValue(empty),
    };
    const failure = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined),
      recovery = jest
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => undefined);
    const worker = new AssignmentCancellationWorker(
      prisma as unknown as PrismaService,
      {} as AssignmentCancellationService,
      { values: { nodeEnv: "test" } } as EnvironmentService,
    );
    await expect(worker.runOnce()).rejects.toBe(error);
    expect(failure.mock.calls).toEqual([
      ["ASSIGNMENT_CANCELLATION_SCAN_FAILED"],
    ]);
    await worker.runOnce();
    expect(recovery.mock.calls).toEqual([
      [heartbeat],
      ["ASSIGNMENT_CANCELLATION_SCAN_RECOVERED"],
    ]);
    await worker.onModuleDestroy();
  });
  it("coalesces one local scan and redacts per-task failures without stopping later tasks", async () => {
    let release!: () => void;
    const pending = new Promise<{ id: string }[]>((r) => {
      release = () => r([{ id: "first" }, { id: "second" }]);
    });
    const prisma = {
      $transaction: jest
        .fn()
        .mockReturnValueOnce(pending)
        .mockResolvedValue([]),
      $queryRaw: jest.fn().mockResolvedValue(empty),
    };
    const processWithdrawal = jest
      .fn()
      .mockRejectedValueOnce(Error("PRIVATE payload"))
      .mockResolvedValue({ mappingMissing: false });
    const warning = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const worker = new AssignmentCancellationWorker(
      prisma as unknown as PrismaService,
      { processWithdrawal } as unknown as AssignmentCancellationService,
      { values: { nodeEnv: "test" } } as EnvironmentService,
    );
    const first = worker.runOnce();
    expect(worker.runOnce()).toBe(first);
    release();
    await first;
    expect(processWithdrawal.mock.calls).toEqual([["first"], ["second"]]);
    expect(warning.mock.calls).toEqual([
      ["ASSIGNMENT_CANCELLATION_RETRY_SCHEDULED"],
    ]);
  });
  it.each([899, 900])(
    "logs only aggregate overdue data at the 900-second threshold (age %s)",
    async (oldestSeconds) => {
      const log = jest
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => undefined);
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);
      const prisma = {
        $transaction: jest.fn().mockResolvedValue([]),
        $queryRaw: jest.fn().mockResolvedValue([
          {
            lane: "withdrawal",
            pending: 2,
            oldestSeconds,
            id: "PRIVATE account",
            objectKey: "PRIVATE key",
          },
          { lane: "deleted-video", pending: 0, oldestSeconds: 0 },
        ]),
      };
      const worker = new AssignmentCancellationWorker(
        prisma as unknown as PrismaService,
        {} as AssignmentCancellationService,
        { values: { nodeEnv: "test" } } as EnvironmentService,
      );
      await worker.runOnce();
      expect(log.mock.calls).toEqual([
        [
          {
            ...heartbeat,
            withdrawalPending: 2,
            withdrawalOldestSeconds: oldestSeconds,
          },
        ],
      ]);
      expect(warn.mock.calls).toEqual(
        oldestSeconds < 900
          ? []
          : [
              [
                {
                  code: "ASSIGNMENT_CANCELLATION_BACKLOG_OVERDUE",
                  lane: "withdrawal",
                  pending: 2,
                  oldestSeconds,
                  thresholdSeconds: 900,
                },
              ],
            ],
      );
      expect(
        JSON.stringify([...log.mock.calls, ...warn.mock.calls]),
      ).not.toContain("PRIVATE");
    },
  );
  it("reports unavailable backlog observation as a scan failure without a success heartbeat", async () => {
    const failure = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const log = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    const error = new Error("PRIVATE database payload");
    const prisma = {
      $transaction: jest.fn().mockResolvedValue([]),
      $queryRaw: jest.fn().mockRejectedValue(error),
    };
    const worker = new AssignmentCancellationWorker(
      prisma as unknown as PrismaService,
      {} as AssignmentCancellationService,
      { values: { nodeEnv: "test" } } as EnvironmentService,
    );
    await expect(worker.runOnce()).rejects.toBe(error);
    expect(log).not.toHaveBeenCalled();
    expect(failure.mock.calls).toEqual([
      ["ASSIGNMENT_CANCELLATION_SCAN_FAILED"],
    ]);
  });
});
