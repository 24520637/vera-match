import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { EnvironmentService } from "../config/environment.service";
import { AuthenticatedRequest } from "./auth-context";
import { readSessionToken } from "./session-token";
import { SessionService } from "./session.service";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly environment: EnvironmentService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    delete request.auth;
    const token = readSessionToken(
      request.headers.cookie,
      this.environment.values.session.cookieName,
    );
    if (!token)
      throw new UnauthorizedException({
        code: "UNAUTHENTICATED",
        message: "A valid session is required.",
      });
    const auth = await this.sessions.resolve(token);
    if (!auth)
      throw new UnauthorizedException({
        code: "UNAUTHENTICATED",
        message: "A valid session is required.",
      });
    request.auth = auth;
    return true;
  }
}
