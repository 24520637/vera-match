import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { ProfileModule } from "../profile/profile.module";
import { PreferencesController } from "./preferences.controller";
import { PreferencesRequestGuard } from "./preferences-request.guard";
import { PreferencesService } from "./preferences.service";

@Module({
  imports: [AuthModule, DatabaseModule, EnvironmentModule, ProfileModule],
  controllers: [PreferencesController],
  providers: [PreferencesService, PreferencesRequestGuard],
})
export class PreferencesModule {}
