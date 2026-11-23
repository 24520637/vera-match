import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { ReviewDraftRequestGuard } from "./review-draft.controller";
import { reviewCursor } from "./review-draft.validation";
import { ReviewOwnerService } from "./review-owner.service";
import {
  ApiOwnerReports,
  ApiUpdateClaim,
  ApiSaveClaimFeedback,
  ApiOpenReviewDispute,
} from "../openapi/reviews";

@ApiTags("Owner reviews")
@Controller("reviews")
@UseGuards(SessionAuthGuard, RolesGuard, ReviewDraftRequestGuard)
@Roles("MEMBER")
export class ReviewOwnerController {
  constructor(private readonly reports: ReviewOwnerService) {}

  @Get("me")
  @ApiOwnerReports()
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.reports.list(request.auth!, reviewCursor(query));
  }

  @Patch("claims/:id")
  @ApiUpdateClaim()
  updateClaim(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.reports.updateClaim(request.auth!, id, body);
  }

  @Patch("claims/:id/feedback")
  @ApiSaveClaimFeedback()
  saveFeedback(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.reports.saveFeedback(request.auth!, id, body);
  }

  @Post(":id/disputes")
  @ApiOpenReviewDispute()
  openDispute(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.reports.openDispute(request.auth!, id, body);
  }
}
