import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { AuthRateLimiter } from "../auth/auth-request.guard";
import { EnvironmentService } from "../config/environment.service";

@Injectable()
export class AssignmentQueuesLimiter extends AuthRateLimiter {}
@Injectable()
export class AssignmentQueuesRequestGuard implements CanActivate {
  constructor(private readonly environment: EnvironmentService, private readonly limiter: AssignmentQueuesLimiter) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if ((request.headers.origin && request.headers.origin !== this.environment.values.corsOrigin) || request.headers["sec-fetch-site"] === "cross-site")
      throw new ForbiddenException({ code: "ORIGIN_DENIED", message: "This request origin is not allowed." });
    this.limiter.consume("assignment-queues:ip", request.socket.remoteAddress ?? "unknown", 600, 60000);
    this.limiter.consume("assignment-queues:actor", request.auth!.user.id, 60, 60000);
    return true;
  }
}
