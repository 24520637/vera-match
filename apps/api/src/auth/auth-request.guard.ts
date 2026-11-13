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

/** Bounded single-process limiter for the modular-monolith deployment. Never stores raw IP/email. */
@Injectable()
export class AuthRateLimiter {
  private readonly windows = new Map<
    string,
    { count: number; expires: number }
  >();
  consume(scope: string, identity: string, limit: number, durationMs = 900000) {
    const now = Date.now();
    const key = createHash("sha256")
      .update(`${scope}:${identity}`)
      .digest("hex");
    let entry = this.windows.get(key);
    if (!entry || entry.expires <= now) {
      if (this.windows.size >= 10000) {
        for (const [id, window] of this.windows)
          if (window.expires <= now) this.windows.delete(id);
      }
      if (this.windows.size >= 10000 && !this.windows.has(key))
        throw new HttpException(
          { code: "AUTH_CAPACITY", message: "Please try again shortly." },
          503,
        );
      entry = { count: 0, expires: now + durationMs };
      this.windows.set(key, entry);
    }
    if (entry.count >= limit)
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: "Too many attempts. Try again later.",
          retryAfterSeconds: Math.ceil((entry.expires - now) / 1000),
        },
        429,
      );
    entry.count++;
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
    if (request.headers.origin !== this.environment.values.corsOrigin)
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
    this.limiter.consume(
      `${action}:ip`,
      request.ip ?? request.socket.remoteAddress ?? "unknown",
      action === "register" ? 20 : action === "resend" ? 10 : 60,
    );
    if (action === "login") {
      const email =
        typeof request.body?.email === "string"
          ? request.body.email.trim().toLowerCase().slice(0, 254)
          : "invalid";
      this.limiter.consume("login:identity", email, 10);
    }
    return true;
  }
}
