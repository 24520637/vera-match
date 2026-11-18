import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { AssignmentCancellationService } from "./assignment-cancellation.service";
import { AssignmentCancellationWorker } from "./assignment-cancellation.worker";
@Module({
  imports: [DatabaseModule, EnvironmentModule],
  providers: [AssignmentCancellationService, AssignmentCancellationWorker],
  exports: [AssignmentCancellationService],
})
export class AssignmentCancellationModule {}
