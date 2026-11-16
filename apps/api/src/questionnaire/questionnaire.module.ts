import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { ProfileModule } from "../profile/profile.module";
import { QuestionnaireCatalog } from "./questionnaire.catalog";
import { QuestionnaireController } from "./questionnaire.controller";
import { QuestionnaireRequestGuard } from "./questionnaire-request.guard";
import { QuestionnaireService } from "./questionnaire.service";

@Module({
  imports: [AuthModule, DatabaseModule, EnvironmentModule, ProfileModule],
  controllers: [QuestionnaireController],
  providers: [QuestionnaireCatalog, QuestionnaireService, QuestionnaireRequestGuard],
})
export class QuestionnaireModule {}
