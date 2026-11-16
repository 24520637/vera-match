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
export class VideoRateLimiter extends AuthRateLimiter {}

@Injectable()
export class VideoRequestGuard implements CanActivate {
  constructor(
    private readonly environment: EnvironmentService,
    private readonly limiter: VideoRateLimiter,
  ) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.method !== "GET") {
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
    }
    if (Object.keys(request.query).length)
      throw new HttpException(
        {
          code: "INVALID_REQUEST",
          message: "Query parameters are not supported.",
        },
        400,
      );
    this.limiter.consume(
      "video:ip",
      request.socket.remoteAddress ?? "unknown",
      600,
      60000,
    );
    this.limiter.consume("video:member", request.auth!.user.id, 60, 60000);
    return true;
  }
}
