import { Logger } from "@nestjs/common";
import { AssignmentCancellationWorker } from "./assignment-cancellation.worker";
import { AssignmentCancellationService } from "./assignment-cancellation.service";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
describe("C051 worker observation boundary", () => {
  afterEach(() => jest.restoreAllMocks());
  it("reports failed scans without private error payloads, then reports recovery", async () => {
    const error = new Error("PRIVATE SQL credentials and signed URL");
    const query = jest.fn().mockRejectedValueOnce(error).mockResolvedValue([]);
    const prisma = {
      $queryRaw: query,
      video: { findMany: jest.fn().mockResolvedValue([]) },
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
      $queryRaw: jest.fn().mockReturnValue(pending),
      video: { findMany: jest.fn().mockResolvedValue([]) },
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
});
