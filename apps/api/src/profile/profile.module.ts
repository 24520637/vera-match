import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { ProfileController } from "./profile.controller";
import { ProfileRequestGuard, ProfileRateLimiter } from "./profile-request.guard";
import { ProfileService } from "./profile.service";

@Module({
  imports: [AuthModule, DatabaseModule, EnvironmentModule],
  controllers: [ProfileController],
  providers: [ProfileService, ProfileRequestGuard, ProfileRateLimiter],
})
export class ProfileModule {}
