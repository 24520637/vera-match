import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsentModule } from "../consent/consent.module";
import { EnvironmentModule } from "../config/environment.module";
import { VideoController } from "./video.controller";
import { PrivateStorageService } from "./private-storage.service";
import { VideoService } from "./video.service";
import { VideoCleanupService } from "./video-cleanup.service";
import { VideoRateLimiter, VideoRequestGuard } from "./video-request.guard";

@Module({
  imports: [AuthModule, ConsentModule, EnvironmentModule],
  controllers: [VideoController],
  providers: [
    VideoCleanupService,
    PrivateStorageService,
    VideoService,
    VideoRateLimiter,
    VideoRequestGuard,
  ],
})
export class VideoModule {}
