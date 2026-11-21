import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EnvironmentModule } from "../config/environment.module";
import { ConsentModule } from "../consent/consent.module";
import { DatabaseModule } from "../database/database.module";
import { SafetyModule } from "../safety/safety.module";
import { MatchingController } from "./matching.controller";
import { MatchingHandles } from "./matching-handles";
import { MatchingRateLimiter, MatchingRequestGuard } from "./matching-request.guard";
import { MatchingService } from "./matching.service";

@Module({
  imports: [AuthModule, EnvironmentModule, ConsentModule, DatabaseModule, SafetyModule],
  controllers: [MatchingController],
  providers: [MatchingService, MatchingHandles, MatchingRateLimiter, MatchingRequestGuard],
})
export class MatchingModule {}
