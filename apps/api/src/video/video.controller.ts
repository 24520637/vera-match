import { Body, Controller, Header, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import type { CurrentUser as SafeUser } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { VideoRequestGuard } from "./video-request.guard";
import { VideoService } from "./video.service";

@Controller("videos")
@UseGuards(SessionAuthGuard, RolesGuard, VideoRequestGuard)
@Roles(UserRole.MEMBER)
export class VideoController {
  constructor(private readonly videos: VideoService) {}
  @Post("upload-intent")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @Header("Referrer-Policy", "no-referrer")
  intent(@CurrentUser() user: SafeUser, @Body() input: unknown) {
    return this.videos.intent(user.id, input);
  }
}
