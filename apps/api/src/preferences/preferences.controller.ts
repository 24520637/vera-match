import { Body, Controller, Get, Header, Patch, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import type { Request } from "express";
import type { CurrentUser as SafeUser } from "../auth/auth-context";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { invalidRequest } from "../profile/profile.validation";
import { PreferencesRequestGuard } from "./preferences-request.guard";
import { PreferencesService } from "./preferences.service";

@Controller("preferences")
@UseGuards(SessionAuthGuard, RolesGuard, PreferencesRequestGuard)
@Roles(UserRole.MEMBER)
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}
  private query(request: Request) {
    if (Object.keys(request.query).length) invalidRequest([{ field: "_form", messages: ["Query parameters are not supported."] }]);
  }
  @Get("me")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  get(@CurrentUser() user: SafeUser, @Req() request: Request) {
    this.query(request);
    return this.preferences.get(user.id);
  }
  @Patch("me")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  patch(@CurrentUser() user: SafeUser, @Body() input: unknown, @Req() request: Request) {
    this.query(request);
    return this.preferences.patch(user.id, input);
  }
}
