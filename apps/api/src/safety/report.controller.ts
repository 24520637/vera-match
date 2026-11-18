import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { SafetyRequestGuard } from "./safety-request.guard";
import { ReportService } from "./report.service";
@Controller("reports")
@UseGuards(SessionAuthGuard, RolesGuard, SafetyRequestGuard)
@Roles("MEMBER")
export class ReportController {
  constructor(private readonly reports: ReportService) {}
  @Post() @HttpCode(202) submitReport(
    @Req() r: AuthenticatedRequest,
    @Body() b: unknown,
  ) {
    return this.reports.submit(r.auth!, b);
  }
}
