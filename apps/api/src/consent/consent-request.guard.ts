import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth-context";
import { AuthRateLimiter } from "../auth/auth-request.guard";
import { EnvironmentService } from "../config/environment.service";
import { ProfileRateLimiter } from "../profile/profile-request.guard";
import { parseConsentPatch } from "./consent.validation";

/** Separate bounded map: grant/profile/general quota exhaustion cannot consume withdrawal reserve. */
@Injectable()
export class ConsentWithdrawalLimiter extends AuthRateLimiter {}
@Injectable()
export class ConsentRequestGuard implements CanActivate {
  constructor(private readonly environment: EnvironmentService, private readonly feature: ProfileRateLimiter,
    private readonly withdrawal: ConsentWithdrawalLimiter) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const ip = request.socket.remoteAddress ?? "unknown", member = request.auth!.user.id;
    if (request.method === "PATCH") {
      if (request.headers.origin !== this.environment.values.corsOrigin) throw new ForbiddenException({ code: "ORIGIN_DENIED", message: "This request origin is not allowed." });
      if (!request.is("application/json")) throw new HttpException({ code: "JSON_REQUIRED", message: "Send a JSON request." }, 415);
      const dto = parseConsentPatch(request.body);
      if (dto.consents.every(item => !item.granted)) {
        this.withdrawal.consume("consent:revoke:ip", ip, 600, 60000);
        this.withdrawal.consume("consent:revoke:member", member, 60, 60000);
        return true;
      }
      this.feature.consume("feature:non-withdrawal:ip", ip, 600, 60000);
      this.feature.consume("consent:grant", member, 60, 60000);
      return true;
    }
    this.feature.consume("feature:non-withdrawal:ip", ip, 600, 60000);
    this.feature.consume("feature:read", member, 120, 60000);
    return true;
  }
}
