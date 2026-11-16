import { Body, Controller, Get, Header, Patch, Req, Res, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import type { Request, Response } from "express";
import type { CurrentUser as SafeUser } from "../auth/auth-context";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { invalidRequest } from "../profile/profile.validation";
import { ConsentRequestGuard } from "./consent-request.guard";
import { ConsentService } from "./consent.service";

@Controller("consents")
@UseGuards(SessionAuthGuard, RolesGuard, ConsentRequestGuard)
@Roles(UserRole.MEMBER)
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}
  private query(request: Request) {
    if (Object.keys(request.query).length) invalidRequest([{ field: "_form", messages: ["Query parameters are not supported."] }]);
  }
  @Get("me")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  get(@CurrentUser() user: SafeUser, @Req() request: Request) {
    this.query(request); return this.consents.get(user.id);
  }
  @Patch("me")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  async patch(@CurrentUser() user: SafeUser, @Body() input: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.query(request);
    const result = await this.consents.patch(user.id, input, request.headers["idempotency-key"]);
    response.setHeader("Access-Control-Expose-Headers", "Retry-After, Idempotency-Replayed");
    if (result.replayed) response.setHeader("Idempotency-Replayed", "true");
    return result.response;
  }
}
