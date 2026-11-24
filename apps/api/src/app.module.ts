import { StaffSecurityModule } from "./staff-security/staff-security.module";
import { RecoveryModule } from "./recovery/recovery.module";
import { AccountClosureModule } from "./account-closure/account-closure.module";
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
import { AssignmentQueuesModule } from "./expert-admin/assignment-queues.module";
import { MatchingModule } from "./matching/matching.module";

@Module({
  imports: [RecoveryModule, StaffSecurityModule,
    AccountClosureModule,
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
    AssignmentQueuesModule,
    MatchingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
