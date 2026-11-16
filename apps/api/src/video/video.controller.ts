import {
  Body,
  Controller,
  Header,
  Post,
  UseGuards,
  Param,
  BadRequestException,
  Get,
  Delete,
  HttpCode,
  UseInterceptors,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import type { CurrentUser as SafeUser } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { VideoRequestGuard } from "./video-request.guard";
import { VideoService } from "./video.service";
import { VideoAuditInterceptor } from "./video-audit.interceptor";

@Controller("videos")
@UseInterceptors(VideoAuditInterceptor)
@UseGuards(SessionAuthGuard, RolesGuard, VideoRequestGuard)
@Roles(UserRole.MEMBER)
export class VideoController {
  @Delete(":id")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  remove(
    @CurrentUser() user: SafeUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length
    )
      throw new BadRequestException({
        code: "INVALID_REQUEST",
        message: "Send an empty JSON object.",
      });
    return this.videos.remove(user.id, id);
  }
  @Get("me")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @Header("Referrer-Policy", "no-referrer")
  list(@CurrentUser() user: SafeUser) {
    return this.videos.list(user.id);
  }
  @Post(":id/playback")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @Header("Referrer-Policy", "no-referrer")
  playback(
    @CurrentUser() user: SafeUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length
    )
      throw new BadRequestException({
        code: "INVALID_REQUEST",
        message: "Send an empty JSON object.",
      });
    return this.videos.playback(user.id, id);
  }
  @Post(":id/confirm")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @Header("Referrer-Policy", "no-referrer")
  confirm(
    @CurrentUser() user: SafeUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length
    )
      throw new BadRequestException({
        code: "INVALID_REQUEST",
        message: "Send an empty JSON object.",
      });
    return this.videos.confirm(user.id, id);
  }
  constructor(private readonly videos: VideoService) {}
  @Post("upload-intent")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @Header("Referrer-Policy", "no-referrer")
  intent(@CurrentUser() user: SafeUser, @Body() input: unknown) {
    return this.videos.intent(user.id, input);
  }
}
