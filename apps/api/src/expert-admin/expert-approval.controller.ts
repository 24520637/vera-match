import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { ExpertApprovalRequestGuard } from "./expert-approval-request.guard";
import { ExpertApprovalService } from "./expert-approval.service";
import { approvalInvalid } from "./expert-approval.validation";

@Controller("expert-admin")
@UseGuards(SessionAuthGuard, RolesGuard, ExpertApprovalRequestGuard)
@Roles(UserRole.MODERATOR)
export class ExpertApprovalController {
  constructor(private readonly approvals: ExpertApprovalService) {}
  @Post("experts/:userId/approvals")
  approve(@Param("userId") targetId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (Object.keys(request.query).length) approvalInvalid("_form", "Query parameters are not supported.");
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(targetId)) approvalInvalid("userId", "Use a valid expert identifier.");
    return this.approvals.approve(request.auth!, targetId, body);
  }
}
