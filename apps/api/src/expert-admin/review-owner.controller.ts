import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
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

  @Patch("claims/:id")
  updateClaim(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.reports.updateClaim(request.auth!, id, body);
  }

  @Patch("claims/:id/feedback")
  saveFeedback(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.reports.saveFeedback(request.auth!, id, body);
  }

  @Post(":id/disputes")
  openDispute(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.reports.openDispute(request.auth!, id, body);
  }
}
