import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { AuthRateLimiter } from "../auth/auth-request.guard";
import { EnvironmentService } from "../config/environment.service";

@Injectable()
export class MatchingRateLimiter extends AuthRateLimiter {}

@Injectable()
export class MatchingRequestGuard implements CanActivate {
  constructor(private readonly env: EnvironmentService, private readonly limiter: MatchingRateLimiter) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const write = request.method === "POST";
    if (write && (request.headers.origin !== this.env.values.corsOrigin ||
      request.headers["sec-fetch-site"] === "cross-site")) {
      throw new ForbiddenException({ code: "ORIGIN_DENIED", message: "This request origin is not allowed." });
    }
    if (write && !request.is("application/json")) {
      throw new HttpException({ code: "JSON_REQUIRED", message: "Send a JSON request." }, 415);
    }
    this.limiter.consume("matching:ip", request.socket.remoteAddress ?? "unknown", 300, 60_000);
    this.limiter.consume(write ? "matching:decision" : "matching:read", request.auth!.user.id, write ? 30 : 60, 60_000);
    return true;
  }
}
