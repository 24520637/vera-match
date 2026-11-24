import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { MatchingRequestGuard } from "./matching-request.guard";
import { MatchConnectionService } from "./match-connection.service";
import { ApiMatchConnection, ApiConnectionSharing, ApiConnectionMessages, ApiSendConnectionMessage } from "../openapi/match-connections";
import { MatchingService } from "./matching.service";
import { ApiRecommendations, ApiMatchingHistory, ApiMatchingDecision } from "../openapi/matching";

@ApiTags("Matching")
@Controller("matches")
@Roles("MEMBER")
@UseGuards(SessionAuthGuard, RolesGuard, MatchingRequestGuard)
export class MatchingController {
  constructor(private readonly matching: MatchingService, private readonly connections: MatchConnectionService) {}

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
  @Get("connections/:connectionId")
  @ApiMatchConnection()
  connection(@Req() request: AuthenticatedRequest, @Param("connectionId") handle: string, @Query() query: object) {
    return this.connections.get(request.auth!, handle, query);
  }

  @Post("connections/:connectionId/sharing")
  @HttpCode(200)
  @ApiConnectionSharing()
  sharing(@Req() request: AuthenticatedRequest, @Param("connectionId") handle: string, @Body() body: unknown) {
    return this.connections.share(request.auth!, handle, request.query, body);
  }

  @Get("connections/:connectionId/messages")
  @ApiConnectionMessages()
  messages(@Req() request: AuthenticatedRequest, @Param("connectionId") handle: string, @Query() query: unknown) {
    return this.connections.messages(request.auth!, handle, query);
  }

  @Post("connections/:connectionId/messages")
  @ApiSendConnectionMessage()
  sendMessage(@Req() request: AuthenticatedRequest, @Param("connectionId") handle: string, @Body() body: unknown) {
    return this.connections.send(request.auth!, handle, request.query, body);
  }

}
