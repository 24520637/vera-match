import { BadRequestException, Body, Controller, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { ExpertPlaybackRequestGuard } from "./expert-playback-request.guard";
import { ExpertPlaybackService } from "./expert-playback.service";
import { ApiAssignmentPlayback } from "../openapi/assignments";

@ApiTags("Assignments")
@Controller("expert/assignments")
@UseGuards(SessionAuthGuard, RolesGuard, ExpertPlaybackRequestGuard)
@Roles("EXPERT")
export class ExpertPlaybackController {
  constructor(private readonly playback: ExpertPlaybackService) {}
  @Post(":assignmentId/playback")
  @ApiAssignmentPlayback()
  @HttpCode(200)
  issue(@Req() request: AuthenticatedRequest, @Param("assignmentId") id: string, @Body() body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
      throw new BadRequestException({ code: "INVALID_REQUEST", message: "Send an empty JSON object." });
    return this.playback.issue(request.auth!, id);
  }
}
