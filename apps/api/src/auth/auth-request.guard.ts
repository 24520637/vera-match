import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { EnvironmentService } from "../config/environment.service";
import { AuthRateLimitException } from "./auth-rate-limit.exception";

type RateLimit = { scope: string; identity: string; limit: number; durationMs?: number };
const maxWindows = 10000;

/** MVP only: one API process, volatile counters. Never stores raw IP/email. */
@Injectable()
export class AuthRateLimiter {
  private readonly windows = new Map<
    string,
    { count: number; expires: number }
  >();
  consume(scope: string, identity: string, limit: number, durationMs = 900000) {
    this.consumeAll({ scope, identity, limit, durationMs });
  }

  /** Charge all applicable buckets only when every bucket can admit the request. */
  consumeAll(...limits: RateLimit[]) {
    const now = Date.now();
    const pending = new Map<string, { count: number; expires: number }>();
    for (const { scope, identity, limit, durationMs = 900000 } of limits) {
      const key = createHash("sha256").update(`${scope}:${identity}`).digest("hex");
      const stored = pending.get(key) ?? this.windows.get(key);
      const entry = stored && stored.expires > now ? stored : { count: 0, expires: now + durationMs };
      if (entry.count >= limit)
        throw new AuthRateLimitException(Math.max(1, Math.ceil((entry.expires - now) / 1000)));
      pending.set(key, { count: entry.count + 1, expires: entry.expires });
    }

    const fits = () => this.windows.size + [...pending.keys()].filter(key => !this.windows.has(key)).length <= maxWindows;
    if (!fits()) {
      for (const [key, window] of this.windows)
        if (window.expires <= now) this.windows.delete(key);
      if (!fits()) throw new HttpException(
        { code: "AUTH_CAPACITY", message: "Please try again shortly." }, 503,
      );
    }
    for (const [key, entry] of pending) this.windows.set(key, entry);
  }
}

@Injectable()
export class AuthRequestGuard implements CanActivate {
  constructor(
    private readonly environment: EnvironmentService,
    private readonly limiter: AuthRateLimiter,
  ) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.headers.origin !== this.environment.values.corsOrigin ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      throw new ForbiddenException({
        code: "ORIGIN_DENIED",
        message: "This request origin is not allowed.",
      });
    if (!request.is("application/json"))
      throw new HttpException(
        { code: "JSON_REQUIRED", message: "Send a JSON request." },
        415,
      );
    const action = context.getHandler().name;
    const clientIp = request.ip ?? request.socket.remoteAddress ?? "unknown";
    this.limiter.consume(
      `${action}:ip`,
      clientIp,
      action === "resetPassword"
        ? 20
        : action === "forgotPassword"
          ? 10
          : action === "register"
            ? 20
            : action === "resend"
              ? 10
              : 60,
    );
    if (action === "login" || action === "forgotPassword") {
      const email =
        typeof request.body?.email === "string"
          ? request.body.email.trim().toLowerCase().slice(0, 254)
          : "invalid";
      this.limiter.consume(
        action === "login"
          ? "login:identity"
          : "forgotPassword:client-identity",
        action === "login" ? email : JSON.stringify([clientIp, email]),
        action === "login" ? 10 : 3,
      );
    }
    if (action === "resetPassword") {
      // Bound attempts against one bearer credential without retaining the raw token.
      const token =
        typeof request.body?.token === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(request.body.token)
          ? request.body.token
          : "invalid";
      this.limiter.consume("resetPassword:token", token, 5);
    }
    return true;
  }
}
