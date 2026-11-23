import { Body, Controller, Get, Header, Patch, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import type { CurrentUser as SafeUser } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { ProfileRequestGuard } from "./profile-request.guard";
import { ProfileService } from "./profile.service";
import { invalidRequest } from "./profile.validation";
import { ApiReadProfile, ApiUpdateProfile } from "../openapi/member-resources";

@ApiTags("Profile")
@Controller("profile")
@UseGuards(SessionAuthGuard, RolesGuard, ProfileRequestGuard)
@Roles(UserRole.MEMBER)
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}
  private query(request: Request) {
    if (Object.keys(request.query).length) invalidRequest([{ field: "_form", messages: ["Query parameters are not supported."] }]);
  }
  @Get("me")
  @ApiReadProfile()
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  get(@CurrentUser() user: SafeUser, @Req() request: Request) {
    this.query(request);
    return this.profiles.get(user.id);
  }
  @Patch("me")
  @ApiUpdateProfile()
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  patch(@CurrentUser() user: SafeUser, @Body() input: unknown, @Req() request: Request) {
    this.query(request);
    return this.profiles.patch(user.id, input);
  }
}
