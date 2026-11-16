import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsentModule } from "../consent/consent.module";
import { EnvironmentModule } from "../config/environment.module";
import { VideoController } from "./video.controller";
import { PrivateStorageService } from "./private-storage.service";
import { VideoService } from "./video.service";
import { VideoRateLimiter, VideoRequestGuard } from "./video-request.guard";

@Module({
  imports: [AuthModule, ConsentModule, EnvironmentModule],
  controllers: [VideoController],
  providers: [
    PrivateStorageService,
    VideoService,
    VideoRateLimiter,
    VideoRequestGuard,
  ],
})
export class VideoModule {}
