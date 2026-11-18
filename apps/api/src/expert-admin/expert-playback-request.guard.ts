import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable } from "@nestjs/common";
import { AuthRateLimiter } from "../auth/auth-request.guard";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { EnvironmentService } from "../config/environment.service";

@Injectable()
export class ExpertPlaybackLimiter extends AuthRateLimiter {}
@Injectable()
export class ExpertPlaybackRequestGuard implements CanActivate {
  constructor(private readonly environment: EnvironmentService, private readonly limiter: ExpertPlaybackLimiter) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.headers.origin !== this.environment.values.corsOrigin || request.headers["sec-fetch-site"] === "cross-site")
      throw new ForbiddenException({ code: "ORIGIN_DENIED", message: "This request origin is not allowed." });
    if (!request.is("application/json")) throw new HttpException({ code: "JSON_REQUIRED", message: "Send a JSON request." }, 415);
    if (Object.keys(request.query).length) throw new HttpException({ code: "INVALID_REQUEST", message: "Query parameters are not supported." }, 400);
    // Independent of owner-media, authentication and consent withdrawal quotas.
    this.limiter.consume("expert-playback:ip", request.socket.remoteAddress ?? "unknown", 600, 60000);
    this.limiter.consume("expert-playback:expert", request.auth!.user.id, 60, 60000);
    return true;
  }
}
