import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { ConsentModule } from "../consent/consent.module";
import { StaffAssuranceSource } from "../safety/staff-assurance.source";
import { ExpertApprovalRegistry, ExpertEvidenceSource } from "./expert-approval.sources";
import { ExpertQueueController, ModeratorQueueController } from "./assignment-queues.controller";
import { AssignmentQueuesService } from "./assignment-queues.service";
import { AssignmentQueuesLimiter, AssignmentQueuesRequestGuard } from "./assignment-queues-request.guard";

@Module({ imports: [AuthModule, DatabaseModule, EnvironmentModule, ConsentModule],
  controllers: [ExpertQueueController, ModeratorQueueController],
  providers: [AssignmentQueuesService, AssignmentQueuesLimiter, AssignmentQueuesRequestGuard,
    StaffAssuranceSource, ExpertApprovalRegistry, ExpertEvidenceSource] })
export class AssignmentQueuesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply((_request: Request, response: Response, next: NextFunction) => {
      response.setHeader("Cache-Control", "private, no-store"); response.setHeader("Referrer-Policy", "no-referrer"); response.vary("Cookie"); next();
    }).forRoutes(ExpertQueueController, ModeratorQueueController);
  }
}
