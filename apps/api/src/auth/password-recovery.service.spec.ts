import { PasswordRecoveryService } from "./password-recovery.service";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { EmailService } from "./email.service";
import { parseEnvironment } from "../config/environment";
const localEnvironment = () => ({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:synthetic@localhost:5433/test",
  MINIO_ROOT_USER: "test-access",
  MINIO_ROOT_PASSWORD: "synthetic-secret",
});

describe("recovery request privacy and bounded worker", () => {
  it("accepts known and unknown addresses without querying accounts in the HTTP path", async () => {
    let release!: (value: null) => void;
    const lookup = jest.fn(
      () =>
        new Promise<null>((resolve) => {
          release = resolve;
        }),
    );
    const service = new PasswordRecoveryService(
      { user: { findUnique: lookup } } as unknown as PrismaService,
      { values: parseEnvironment(localEnvironment()) } as EnvironmentService,
      {} as EmailService,
    );
    const first = service.request("known@example.invalid");
    expect(service.request("unknown@example.invalid")).toEqual(first);
    expect(lookup).not.toHaveBeenCalled();
    await new Promise(setImmediate);
    expect(lookup).toHaveBeenCalledTimes(1);
    release(null);
    // Complete the second background lookup without adding a timing dependency to HTTP.
    lookup.mockImplementation(async () => null);
    await service.onModuleDestroy();
    expect(() => service.request("unknown@example.invalid")).toThrow();
  });
  it("bounds queued requests independently of account existence", async () => {
    const lookup = jest.fn(async () => null);
    const service = new PasswordRecoveryService(
      { user: { findUnique: lookup } } as unknown as PrismaService,
      { values: parseEnvironment(localEnvironment()) } as EnvironmentService,
      {} as EmailService,
    );
    for (let i = 0; i < 32; i++) service.request(`${i}@example.invalid`);
    expect(() => service.request("overflow@example.invalid")).toThrow(
      "Please try again shortly.",
    );
    expect(lookup).not.toHaveBeenCalled();
    await service.onModuleDestroy();
    expect(lookup).toHaveBeenCalledTimes(32);
  });
});
