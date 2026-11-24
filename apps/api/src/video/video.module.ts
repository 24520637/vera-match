import { AssignmentCancellationModule } from "../assignment-cancellation/assignment-cancellation.module";
import { AccountClosureModule } from "../account-closure/account-closure.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsentModule } from "../consent/consent.module";
import { EnvironmentModule } from "../config/environment.module";
import { VideoController } from "./video.controller";
import { PrivateStorageService } from "./private-storage.service";
import { VideoService } from "./video.service";
import { VideoCleanupService } from "./video-cleanup.service";
import { VideoAuditInterceptor } from "./video-audit.interceptor";
import { VideoRateLimiter, VideoRequestGuard } from "./video-request.guard";

@Module({
  imports: [
    AuthModule,
    ConsentModule,
    EnvironmentModule,
    AssignmentCancellationModule,
    AccountClosureModule,
  ],
  controllers: [VideoController],
  providers: [
    VideoAuditInterceptor,
    VideoCleanupService,
    PrivateStorageService,
    VideoService,
    VideoRateLimiter,
    VideoRequestGuard,
  ],
  exports: [PrivateStorageService],
})
export class VideoModule {}
