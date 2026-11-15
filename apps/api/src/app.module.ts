import { Module } from "@nestjs/common";
import { EnvironmentModule } from "./config/environment.module";
import { HealthController } from "./health.controller";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { ProfileModule } from "./profile/profile.module";

@Module({
  imports: [EnvironmentModule, DatabaseModule, AuthModule, ProfileModule],
  controllers: [HealthController],
})
export class AppModule {}
