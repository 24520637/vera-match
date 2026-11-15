import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ResetPasswordDto } from "./reset-password.dto";

describe("reset password input", () => {
  it.each(["short", "a".repeat(129), null, 123])(
    "rejects an invalid replacement password",
    async (newPassword) => {
      expect(
        (
          await validate(
            plainToInstance(ResetPasswordDto, {
              token: "a".repeat(43),
              newPassword,
            }),
          )
        ).length,
      ).toBeGreaterThan(0);
    },
  );
  it("preserves whitespace and counts Unicode characters consistently with registration", async () => {
    for (const newPassword of [" twelve words ", "🔐".repeat(65)]) {
      const input = plainToInstance(ResetPasswordDto, {
        token: "a".repeat(43),
        newPassword,
      });
      expect(await validate(input)).toEqual([]);
      expect(input.newPassword).toBe(newPassword);
    }
  });
  it("rejects a missing or malformed token", async () => {
    for (const token of [undefined, "bad", "a".repeat(44), 1])
      expect(
        (
          await validate(
            plainToInstance(ResetPasswordDto, {
              token,
              newPassword: "synthetic-password",
            }),
          )
        ).length,
      ).toBeGreaterThan(0);
  });
});
