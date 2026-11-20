import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AssignmentQueuesRequestGuard } from "./assignment-queues-request.guard";
import { AssignmentQueuesService } from "./assignment-queues.service";

@Controller("expert/assignments")
@UseGuards(SessionAuthGuard, RolesGuard, AssignmentQueuesRequestGuard)
@Roles("EXPERT")
export class ExpertQueueController {
  constructor(private readonly queues: AssignmentQueuesService) {}
  @Get("me") list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.queues.list(request.auth!, "EXPERT", query);
  }
}
@Controller("expert-admin/assignments")
@UseGuards(SessionAuthGuard, RolesGuard, AssignmentQueuesRequestGuard)
@Roles("MODERATOR")
export class ModeratorQueueController {
  constructor(private readonly queues: AssignmentQueuesService) {}
  @Get() list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.queues.list(request.auth!, "MODERATOR", query);
  }
  @Get("candidate") candidate(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.queues.candidate(request.auth!, query);
  }
}
