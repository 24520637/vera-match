import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { ReviewDraftRequestGuard } from "./review-draft.controller";
import { reviewCursor } from "./review-draft.validation";
import { ReviewQaService } from "./review-qa.service";

@Controller("qa/reviews")
@UseGuards(SessionAuthGuard, RolesGuard, ReviewDraftRequestGuard)
@Roles("MODERATOR")
export class ReviewQaController {
  constructor(private readonly qa: ReviewQaService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.qa.list(request.auth!, reviewCursor(query));
  }

  @Get(":id")
  read(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.qa.read(request.auth!, id);
  }

  @Post(":id/return")
  @HttpCode(200)
  returnReview(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.qa.returnReview(request.auth!, id, body);
  }
}
