import { EnvironmentService } from "../config/environment.service";
import { parseEnvironment } from "../config/environment";
import { PasswordService } from "./password.service";

describe("Argon2id password helper", () => {
  const values = parseEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost:5433/vera_test",
    MINIO_ROOT_USER: "synthetic",
    MINIO_ROOT_PASSWORD: "synthetic-test-only",
  });
  const service = new PasswordService({ values } as EnvironmentService);
  it("uses Argon2id with explicit work factors and independent salts", async () => {
    const first = await service.hash("synthetic-password");
    const second = await service.hash("synthetic-password");
    expect(first).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("synthetic-password");
    await expect(service.verify(first, "synthetic-password")).resolves.toBe(
      true,
    );
    await expect(service.verify(first, "wrong-password")).resolves.toBe(false);
  });
  it.each([
    "",
    "not-a-hash",
    "$argon2i$v=19$m=65536,t=3,p=1$invalid$invalid",
    "$argon2id$v=19$m=999999999,t=3,p=1$abcdefghijklmnop$abcdefghijklmnopqrstuvwxyz123456",
    "$argon2id$v=19$m=65536,t=999999,p=1$abcdefghijklmnop$abcdefghijklmnopqrstuvwxyz123456",
  ])("rejects invalid stored hashes safely", async (hash) => {
    await expect(service.verify(hash, "synthetic-password")).resolves.toBe(
      false,
    );
  });
  it("handles Unicode without normalization or truncation", async () => {
    const hash = await service.hash("Mật-khẩu-tổng-hợp-🔒");
    await expect(service.verify(hash, "Mật-khẩu-tổng-hợp-🔒")).resolves.toBe(
      true,
    );
    await expect(service.verify(hash, "Mat-khau-tong-hop-🔒")).resolves.toBe(
      false,
    );
  });
  it("bounds input size before invoking native hashing", async () => {
    await expect(service.hash("")).rejects.toThrow("between 1 and 1024");
    await expect(service.hash("a".repeat(1025))).rejects.toThrow(
      "between 1 and 1024",
    );
    await expect(service.verify("invalid", "a".repeat(1025))).resolves.toBe(
      false,
    );
  });
  it.each([
    { ARGON2_MEMORY_COST_KIB: "1024" },
    { ARGON2_TIME_COST: "1" },
    { ARGON2_PARALLELISM: "0" },
    { ARGON2_MEMORY_COST_KIB: "99999999" },
  ])("rejects unsafe work factors %o", (overrides) => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
        DATABASE_URL: values.databaseUrl,
        MINIO_ROOT_USER: "synthetic",
        MINIO_ROOT_PASSWORD: "synthetic-test-only",
        ...overrides,
      }),
    ).toThrow("ARGON2");
  });
});
