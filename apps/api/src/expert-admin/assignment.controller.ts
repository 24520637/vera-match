import { Body, Controller, Headers, Post, Req, Res, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { ExpertApprovalRequestGuard } from "./expert-approval-request.guard";
import { approvalInvalid } from "./expert-approval.validation";
import { AssignmentService } from "./assignment.service";

@Controller("expert-admin/assignments")
@UseGuards(SessionAuthGuard, RolesGuard, ExpertApprovalRequestGuard)
@Roles(UserRole.MODERATOR)
export class AssignmentController {
  constructor(private readonly assignments: AssignmentService) {}
  @Post()
  async create(@Body() input: unknown, @Headers("idempotency-key") key: unknown, @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response) {
    if (Object.keys(request.query).length) approvalInvalid("_form", "Query parameters are not supported.");
    const result = await this.assignments.create(request.auth!, input, key);
    response.setHeader("Access-Control-Expose-Headers", "Retry-After, Idempotency-Replayed");
    if (result.replayed) response.setHeader("Idempotency-Replayed", "true");
    return result.response;
  }
}
