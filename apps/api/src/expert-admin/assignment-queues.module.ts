import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { ConsentModule } from "../consent/consent.module";
import { SafetyModule } from "../safety/safety.module";
import { StaffSecurityModule } from "../staff-security/staff-security.module";
import { ExpertApprovalRegistry, ExpertEvidenceSource } from "./expert-approval.sources";
import { AssignmentGrantsController, ExpertQueueController, ModeratorQueueController } from "./assignment-queues.controller";
import { AssignmentQueuesService } from "./assignment-queues.service";
import { AssignmentQueuesLimiter, AssignmentQueuesRequestGuard } from "./assignment-queues-request.guard";
import { AssignmentGrantProvisioningSource } from "./assignment-grant-provisioning.source";
import { AssignmentGrantsService } from "./assignment-grants.service";

@Module({ imports: [AuthModule, DatabaseModule, EnvironmentModule, ConsentModule, SafetyModule, StaffSecurityModule],
  controllers: [ExpertQueueController, ModeratorQueueController, AssignmentGrantsController],
  providers: [AssignmentQueuesService, AssignmentQueuesLimiter, AssignmentQueuesRequestGuard,
    ExpertApprovalRegistry, ExpertEvidenceSource,
    AssignmentGrantProvisioningSource, AssignmentGrantsService], exports: [AssignmentGrantsService] })
export class AssignmentQueuesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply((_request: Request, response: Response, next: NextFunction) => {
      response.setHeader("Cache-Control", "private, no-store"); response.setHeader("Referrer-Policy", "no-referrer"); response.vary("Cookie"); next();
    }).forRoutes(ExpertQueueController, ModeratorQueueController, AssignmentGrantsController);
  }
}
