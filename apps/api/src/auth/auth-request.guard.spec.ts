import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { AuthRateLimiter, AuthRequestGuard } from "./auth-request.guard";
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
});
