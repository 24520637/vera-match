import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
} from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth-context";
import { AuthRateLimiter } from "../auth/auth-request.guard";
import { EnvironmentService } from "../config/environment.service";
@Injectable()
export class SafetyRateLimiter extends AuthRateLimiter {}
@Injectable()
export class SafetyRequestGuard implements CanActivate {
  constructor(
    private readonly environment: EnvironmentService,
    private readonly limiter: SafetyRateLimiter,
  ) {}
  canActivate(context: ExecutionContext) {
    const r = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (r.method !== "GET") {
      if (
        r.headers.origin !== this.environment.values.corsOrigin ||
        r.headers["sec-fetch-site"] === "cross-site"
      )
        throw new ForbiddenException({
          code: "ORIGIN_DENIED",
          message: "This request origin is not allowed.",
        });
      if (!r.is("application/json"))
        throw new HttpException(
          { code: "JSON_REQUIRED", message: "Send a JSON request." },
          415,
        );
      if (Object.keys(r.query).length)
        throw new HttpException(
          {
            code: "INVALID_REQUEST",
            message: "Query parameters are not supported for changes.",
          },
          400,
        );
    }
    const action = context.getHandler().name;
    this.limiter.consume(
      "safety:ip",
      r.socket.remoteAddress ?? "unknown",
      600,
      60000,
    );
    this.limiter.consume(
      "safety:" + action,
      r.auth!.user.id,
      action === "submitReport"
        ? 5
        : action === "block"
          ? 20
          : r.method === "GET"
            ? 120
            : 60,
      60000,
    );
    return true;
  }
}
