import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { ExpertApprovalController } from "./expert-approval.controller";
import { ExpertApprovalRateLimiter, ExpertApprovalRequestGuard } from "./expert-approval-request.guard";
import { ExpertApprovalService } from "./expert-approval.service";
import { ExpertApprovalRegistry, ExpertEvidenceSource } from "./expert-approval.sources";
import type { Request, Response, NextFunction } from "express";
import { ConsentModule } from "../consent/consent.module";
import { AssignmentController } from "./assignment.controller";
import { AssignmentService } from "./assignment.service";
import { VideoModule } from "../video/video.module";
import { AssignmentAccessService } from "./assignment-access.service";
import { ExpertMfaSource } from "./expert-mfa.source";
import { ExpertPlaybackController } from "./expert-playback.controller";
import { ExpertPlaybackService } from "./expert-playback.service";
import { ExpertPlaybackLimiter, ExpertPlaybackRequestGuard } from "./expert-playback-request.guard";
import { AssignmentDraftController, ReviewDraftController, ReviewDraftRequestGuard } from "./review-draft.controller";
import { ReviewDraftService } from "./review-draft.service";
import { SafetyModule } from "../safety/safety.module";
import { ReviewQaController } from "./review-qa.controller";
import { ReviewQaService } from "./review-qa.service";

@Module({ imports: [AuthModule, DatabaseModule, EnvironmentModule, ConsentModule, VideoModule, SafetyModule], controllers: [ExpertApprovalController, AssignmentController, ExpertPlaybackController, AssignmentDraftController, ReviewDraftController, ReviewQaController],
  providers: [ExpertApprovalService, ExpertApprovalRegistry, ExpertEvidenceSource, ExpertApprovalRateLimiter, ExpertApprovalRequestGuard, AssignmentService,
    AssignmentAccessService, ExpertMfaSource, ExpertPlaybackService, ExpertPlaybackLimiter, ExpertPlaybackRequestGuard, ReviewDraftService, ReviewDraftRequestGuard, ReviewQaService] })
export class ExpertApprovalModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply((_request: Request, response: Response, next: NextFunction) => {
      // Middleware covers validation, authentication and rate-limit errors as well.
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.vary("Cookie");
      next();
    }).forRoutes(ExpertApprovalController, AssignmentController, ExpertPlaybackController, AssignmentDraftController, ReviewDraftController, ReviewQaController);
  }
}
