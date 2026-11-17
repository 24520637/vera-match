import { SafetyModule } from "./safety/safety.module";
import { Module } from "@nestjs/common";
import { EnvironmentModule } from "./config/environment.module";
import { HealthController } from "./health.controller";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { ProfileModule } from "./profile/profile.module";
import { QuestionnaireModule } from "./questionnaire/questionnaire.module";
import { PreferencesModule } from "./preferences/preferences.module";
import { ConsentModule } from "./consent/consent.module";
import { VideoModule } from "./video/video.module";
import { ExpertApprovalModule } from "./expert-admin/expert-approval.module";

@Module({
  imports: [
    EnvironmentModule,
    DatabaseModule,
    AuthModule,
    ProfileModule,
    QuestionnaireModule,
    PreferencesModule,
    ConsentModule,
    VideoModule,
    SafetyModule,
    ExpertApprovalModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
