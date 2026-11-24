import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AssignmentQueuesRequestGuard } from "./assignment-queues-request.guard";
import { AssignmentQueuesService } from "./assignment-queues.service";
import { AssignmentGrantsService } from "./assignment-grants.service";
import {
  ApiExpertAssignments,
  ApiModeratorAssignments,
  ApiAssignmentCandidate,
  ApiGrantModeratorAssignment,
  ApiRevokeModeratorAssignment,
} from "../openapi/assignments";

@ApiTags("Assignments")
@Controller("expert/assignments")
@UseGuards(SessionAuthGuard, RolesGuard, AssignmentQueuesRequestGuard)
@Roles("EXPERT")
export class ExpertQueueController {
  constructor(private readonly queues: AssignmentQueuesService) {}
  @ApiExpertAssignments()
  @Get("me") list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.queues.list(request.auth!, "EXPERT", query);
  }
}

@ApiTags("Assignments")
@Controller("expert-admin/assignment-grants")
@UseGuards(SessionAuthGuard, RolesGuard, AssignmentQueuesRequestGuard)
@Roles("ADMIN")
export class AssignmentGrantsController {
  constructor(private readonly grants: AssignmentGrantsService) {}

  @Post()
  @ApiGrantModeratorAssignment()
  grant(@Req() request: AuthenticatedRequest, @Body() input: unknown) {
    return this.grants.grant(request.auth!, input);
  }

  @Post("revoke")
  @HttpCode(200)
  @ApiRevokeModeratorAssignment()
  revoke(@Req() request: AuthenticatedRequest, @Body() input: unknown) {
    return this.grants.revoke(request.auth!, input);
  }
}
@ApiTags("Assignments")
@Controller("expert-admin/assignments")
@UseGuards(SessionAuthGuard, RolesGuard, AssignmentQueuesRequestGuard)
@Roles("MODERATOR")
export class ModeratorQueueController {
  constructor(private readonly queues: AssignmentQueuesService) {}
  @ApiModeratorAssignments()
  @Get() list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.queues.list(request.auth!, "MODERATOR", query);
  }
  @ApiAssignmentCandidate()
  @Get("candidate") candidate(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.queues.candidate(request.auth!, query);
  }
}
