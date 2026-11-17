import { object } from "./safety.validation";
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { SafetyRequestGuard } from "./safety-request.guard";
import { ModerationService } from "./moderation.service";
@Controller("moderation/reports")
@UseGuards(SessionAuthGuard, RolesGuard, SafetyRequestGuard)
@Roles("MODERATOR")
export class ModerationController {
  constructor(private readonly reports: ModerationService) {}
  @Get() listReports(@Req() r: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.list(r.auth!, q);
  }
  @Get(":id") reportDetail(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Query() q: unknown,
  ) {
    object(q, []);
    return this.reports.detail(r.auth!, id);
  }
  @Patch(":id") transitionReport(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.reports.transition(r.auth!, id, b);
  }
}
