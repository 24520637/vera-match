import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth-context";
import { AuthRateLimiter } from "../auth/auth-request.guard";
import { EnvironmentService } from "../config/environment.service";

/** Separate instance/buckets: profile traffic never consumes auth or withdrawal capacity. */
@Injectable()
export class ProfileRateLimiter extends AuthRateLimiter {}

@Injectable()
export class ProfileRequestGuard implements CanActivate {
  constructor(private readonly environment: EnvironmentService, private readonly limiter: ProfileRateLimiter) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const mutation = request.method === "PATCH";
    if (mutation) {
      if (request.headers.origin !== this.environment.values.corsOrigin) {
        throw new ForbiddenException({ code: "ORIGIN_DENIED", message: "This request origin is not allowed." });
      }
      if (!request.is("application/json")) throw new HttpException({ code: "JSON_REQUIRED", message: "Send a JSON request." }, 415);
    }
    this.limiter.consume("feature:non-withdrawal:ip", request.socket.remoteAddress ?? "unknown", 600, 60000);
    this.limiter.consume(mutation ? "profile:patch" : "feature:read", request.auth!.user.id, mutation ? 20 : 120, 60000);
    return true;
  }
}
