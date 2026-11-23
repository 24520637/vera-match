import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { MatchingRequestGuard } from "./matching-request.guard";
import { MatchingService } from "./matching.service";
import { ApiRecommendations, ApiMatchingHistory, ApiMatchingDecision } from "../openapi/matching";

@ApiTags("Matching")
@Controller("matches")
@Roles("MEMBER")
@UseGuards(SessionAuthGuard, RolesGuard, MatchingRequestGuard)
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Get("recommendations")
  @ApiRecommendations()
  recommendations(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.matching.recommendations(request.auth!, query);
  }

  @Get("decisions")
  @ApiMatchingHistory()
  history(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.matching.history(request.auth!, query);
  }

  @Post(":pairId/decision")
  @ApiMatchingDecision()
  @HttpCode(200)
  decision(@Req() request: AuthenticatedRequest, @Param("pairId") pairId: string, @Body() body: unknown) {
    return this.matching.decide(request.auth!, pairId, request.query, body);
  }
}
