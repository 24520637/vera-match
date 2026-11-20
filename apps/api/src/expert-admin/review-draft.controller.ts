import { type CanActivate, Body, Controller, type ExecutionContext, ForbiddenException, Get, HttpCode, HttpException, Injectable, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { AuthRateLimiter } from "../auth/auth-request.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { EnvironmentService } from "../config/environment.service";
import { ReviewDraftService } from "./review-draft.service";
import { requireEmpty } from "./review-draft.validation";

@Injectable()
export class ReviewDraftRequestGuard implements CanActivate {
  private readonly limiter = new AuthRateLimiter();
  constructor(private readonly environment: EnvironmentService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.headers["sec-fetch-site"] === "cross-site" ||
      (request.method !== "GET" && request.headers.origin !== this.environment.values.corsOrigin))
      throw new ForbiddenException({ code: "ORIGIN_DENIED", message: "This request origin is not allowed." });
    if (request.method !== "GET" && !request.is("application/json"))
      throw new HttpException({ code: "JSON_REQUIRED", message: "Send a JSON request." }, 415);
    if (Object.keys(request.query).length)
      throw new HttpException({ code: "INVALID_REQUEST", message: "Query parameters are not supported." }, 400);
    this.limiter.consume("review-draft:ip", request.socket.remoteAddress ?? "unknown", 600, 60000);
    this.limiter.consume("review-draft:expert", request.auth!.user.id, 60, 60000);
    return true;
  }
}

@Controller("expert/assignments")
@UseGuards(SessionAuthGuard, RolesGuard, ReviewDraftRequestGuard)
@Roles("EXPERT")
export class AssignmentDraftController {
  constructor(private readonly drafts: ReviewDraftService) {}

  @Get(":id/draft")
  read(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.drafts.read(request.auth!, id);
  }

  @Post(":id/draft")
  @HttpCode(200)
  initialize(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    requireEmpty(body);
    return this.drafts.read(request.auth!, id, true);
  }
}

@Controller("expert/reviews")
@UseGuards(SessionAuthGuard, RolesGuard, ReviewDraftRequestGuard)
@Roles("EXPERT")
export class ReviewDraftController {
  constructor(private readonly drafts: ReviewDraftService) {}

  @Patch(":id/draft")
  save(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.drafts.save(request.auth!, id, body);
  }

  @Post(":id/observations")
  @HttpCode(200)
  append(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.drafts.save(request.auth!, id, body, true);
  }
}
