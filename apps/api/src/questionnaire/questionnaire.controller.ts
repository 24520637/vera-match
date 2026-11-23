import { Body, Controller, Get, Header, Put, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import type { Request } from "express";
import type { CurrentUser as SafeUser } from "../auth/auth-context";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { invalidRequest } from "../profile/profile.validation";
import { QuestionnaireCatalog } from "./questionnaire.catalog";
import { QuestionnaireRequestGuard } from "./questionnaire-request.guard";
import { QuestionnaireService } from "./questionnaire.service";
import { parseQuestionnaireQuery } from "./questionnaire.validation";
import { ApiReadQuestionnaire, ApiUpdateQuestionnaire } from "../openapi/member-resources";

@ApiTags("Questionnaire")
@Controller("questionnaire")
@UseGuards(SessionAuthGuard, RolesGuard, QuestionnaireRequestGuard)
@Roles(UserRole.MEMBER)
export class QuestionnaireController {
  constructor(private readonly questionnaire: QuestionnaireService, private readonly catalogs: QuestionnaireCatalog) {}
  @Get("me")
  @ApiReadQuestionnaire()
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  get(@CurrentUser() user: SafeUser, @Req() request: Request) {
    return this.questionnaire.get(user.id, parseQuestionnaireQuery(request.query, this.catalogs));
  }
  @Put("me")
  @ApiUpdateQuestionnaire()
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  put(@CurrentUser() user: SafeUser, @Body() input: unknown, @Req() request: Request) {
    if (Object.keys(request.query).length) invalidRequest([{ field: "_form", messages: ["PUT uses the body catalog version, not query parameters."] }]);
    return this.questionnaire.put(user.id, input);
  }
}
