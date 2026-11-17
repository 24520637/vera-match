import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth-context";
import { AuthRateLimiter } from "../auth/auth-request.guard";
import { EnvironmentService } from "../config/environment.service";

@Injectable()
export class ExpertApprovalRateLimiter extends AuthRateLimiter {}

@Injectable()
export class ExpertApprovalRequestGuard implements CanActivate {
  constructor(private readonly environment: EnvironmentService, private readonly limiter: ExpertApprovalRateLimiter) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.headers.origin !== this.environment.values.corsOrigin || request.headers["sec-fetch-site"] === "cross-site")
      throw new ForbiddenException({ code: "ORIGIN_DENIED", message: "This request origin is not allowed." });
    if (!request.is("application/json")) throw new HttpException({ code: "JSON_REQUIRED", message: "Send a JSON request." }, 415);
    // Separate process-local buckets; never consume auth or consent withdrawal quotas.
    this.limiter.consume("expert-approval:ip", request.socket.remoteAddress ?? "unknown", 60, 60000);
    this.limiter.consume("expert-approval:moderator", request.auth!.user.id, 20, 60000);
    return true;
  }
}
