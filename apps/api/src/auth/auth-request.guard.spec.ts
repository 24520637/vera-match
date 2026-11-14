import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { AuthRateLimiter, AuthRequestGuard } from "./auth-request.guard";
import { AuthRateLimitException } from "./auth-rate-limit.exception";
import { EnvironmentService } from "../config/environment.service";

describe("auth request safety", () => {
  const context = (origin: string | undefined, json = true) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { origin },
          is: () => json,
          ip: "127.0.0.1",
          body: {},
        }),
      }),
      getHandler: () => function register() {},
    }) as unknown as ExecutionContext;
  it("rejects missing/foreign origins and non-JSON before handling credentials", () => {
    const guard = new AuthRequestGuard(
      { values: { corsOrigin: "http://localhost:3000" } } as EnvironmentService,
      new AuthRateLimiter(),
    );
    expect(() => guard.canActivate(context(undefined))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      guard.canActivate(context("https://attacker.invalid")),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(context("http://localhost:3000", false)),
    ).toThrow("Send a JSON request.");
    expect(guard.canActivate(context("http://localhost:3000"))).toBe(true);
  });
  it("enforces rate windows without trusting a caller-supplied clock", () => {
    const limiter = new AuthRateLimiter();
    limiter.consume("register", "synthetic", 1);
    expect(() => limiter.consume("register", "synthetic", 1)).toThrow(
      "Too many attempts",
    );
  });
  it("reports rounded remaining time and opens a new window only after expiry", () => {
    const clock = jest.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const limiter = new AuthRateLimiter();
      limiter.consume("login", "synthetic", 1, 2500);
      clock.mockReturnValue(1501);
      try {
        limiter.consume("login", "synthetic", 1, 2500);
        throw new Error("Expected limit");
      } catch (error) {
        expect(error).toBeInstanceOf(AuthRateLimitException);
        expect((error as AuthRateLimitException).getResponse()).toEqual({
          code: "RATE_LIMITED",
          message: "Too many attempts. Try again later.",
          retryAfterSeconds: 2,
        });
      }
      clock.mockReturnValue(3500);
      expect(() =>
        limiter.consume("login", "synthetic", 1, 2500),
      ).not.toThrow();
    } finally {
      clock.mockRestore();
    }
  });
});
