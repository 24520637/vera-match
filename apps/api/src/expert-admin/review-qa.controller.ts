import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
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

  @Get("disputes")
  listDisputes(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.qa.listDisputes(request.auth!, reviewCursor(query));
  }

  @Get("disputes/:id")
  readDispute(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.qa.readDispute(request.auth!, id);
  }

  @Patch("disputes/:id")
  decideDispute(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.qa.decideDispute(request.auth!, id, body);
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

  @Post(":id/approve")
  @HttpCode(200)
  approve(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.qa.approve(request.auth!, id, body);
  }
}
