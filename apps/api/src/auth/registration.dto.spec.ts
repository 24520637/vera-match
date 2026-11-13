import { BadRequestException } from "@nestjs/common";
import { RegistrationDto } from "./registration.dto";
import { createValidationPipe } from "./auth-validation";

describe("registration validation", () => {
  const valid = () => ({
    email: "  Member@Example.Invalid ",
    password: "synthetic-password-123",
    declaredAdult: true,
  });
  const parse = (body: object) =>
    createValidationPipe().transform(body, {
      type: "body",
      metatype: RegistrationDto,
    });
  it("normalizes email and optional display name without modifying the password", async () => {
    const result = await parse({ ...valid(), displayName: " Example Member " });
    expect(result.email).toBe("member@example.invalid");
    expect(result.displayName).toBe("Example Member");
    expect(result.password).toBe(valid().password);
  });
  it.each([
    { email: "invalid" },
    { email: "x\r\n@example.invalid" },
    { password: "short" },
    { password: "a".repeat(129) },
    { password: 1234567890123 },
    { declaredAdult: false },
    { declaredAdult: undefined },
    { declaredAdult: "true" },
    { declaredAdult: 1 },
    { displayName: " " },
    { role: "ADMIN" },
    { status: "ACTIVE" },
  ])("rejects invalid or privileged fields %o", async (changes) => {
    await expect(parse({ ...valid(), ...changes })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it("does not echo password values or the request object in validation errors", async () => {
    try {
      await parse({ ...valid(), password: "private" });
      throw new Error("Expected failure");
    } catch (error) {
      const body = (error as BadRequestException).getResponse();
      expect(body).toMatchObject({ code: "VALIDATION_FAILED" });
      expect(JSON.stringify(body)).not.toContain("private");
      expect(JSON.stringify(body)).not.toContain("target");
    }
  });
});
