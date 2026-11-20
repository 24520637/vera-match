import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { ReviewDraftRequestGuard } from "./review-draft.controller";
import { reviewCursor } from "./review-draft.validation";
import { ReviewOwnerService } from "./review-owner.service";

@Controller("reviews")
@UseGuards(SessionAuthGuard, RolesGuard, ReviewDraftRequestGuard)
@Roles("MEMBER")
export class ReviewOwnerController {
  constructor(private readonly reports: ReviewOwnerService) {}

  @Get("me")
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.reports.list(request.auth!, reviewCursor(query));
  }
}
