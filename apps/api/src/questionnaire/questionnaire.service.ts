import { ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AccountStatus, MemberResource, Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { QuestionCatalog, QuestionnaireCatalog } from "./questionnaire.catalog";
import { legacyQuestionnaire, parseQuestionnairePut, projectAnswers } from "./questionnaire.validation";

const key = (userId: string) => ({ userId_resource: { userId, resource: MemberResource.QUESTIONNAIRE } });
function conflict(): never {
  throw new ConflictException({ code: "RESOURCE_REVISION_CONFLICT", message: "This resource changed. Reload and review your edits before saving.",
    details: [{ field: "_form", messages: ["Reload before submitting again."] }] });
}

@Injectable()
export class QuestionnaireService {
  constructor(private readonly prisma: PrismaService, private readonly catalogs: QuestionnaireCatalog) {}
  private async authorize(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true, role: true, emailVerifiedAt: true } });
    if (!user || user.status !== AccountStatus.ACTIVE || user.role !== UserRole.MEMBER || !user.emailVerifiedAt) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "An active verified member is required." });
    }
  }
  private async safe<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: "QUESTIONNAIRE_STORE_UNAVAILABLE", message: "Questionnaire storage is temporarily unavailable." });
    }
  }
  get(userId: string, catalog: QuestionCatalog) {
    return this.safe(() => this.prisma.$transaction(async tx => {
      await this.authorize(tx, userId);
      const revision = Number((await tx.memberResourceRevision.findUnique({ where: key(userId) }))?.revision ?? 0n);
      const rows = await tx.questionnaireAnswer.findMany({ where: { userId, questionnaireVersion: catalog.version } });
      return { revision, questionnaire: projectAnswers(rows, catalog, revision) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }
  put(userId: string, input: unknown) {
    const dto = parseQuestionnairePut(input, this.catalogs);
    const catalog = this.catalogs.find(dto.questionnaireVersion)!;
    return this.safe(() => this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      await this.authorize(tx, userId);
      const current = Number((await tx.memberResourceRevision.findUnique({ where: key(userId) }))?.revision ?? 0n);
      if (current !== dto.expectedRevision) return conflict();
      if (current === Number.MAX_SAFE_INTEGER) throw new ServiceUnavailableException({
        code: "QUESTIONNAIRE_REVISION_EXHAUSTED", message: "Questionnaire changes require support review.",
      });
      const existing = await tx.questionnaireAnswer.findMany({ where: { userId, questionnaireVersion: catalog.version } });
      // Full PUT may explicitly replace malformed text/partial canonical sets, never extra unknown rows.
      if (existing.some(row => !catalog.questions.some(question => question.key === row.questionKey))) return legacyQuestionnaire(current, true);
      await tx.memberResourceRevision.upsert({ where: key(userId), create: { userId, resource: MemberResource.QUESTIONNAIRE }, update: {} });
      const changed = await tx.memberResourceRevision.updateMany({
        where: { userId, resource: MemberResource.QUESTIONNAIRE, revision: BigInt(dto.expectedRevision) },
        data: { revision: { increment: 1n } },
      });
      if (changed.count !== 1) return conflict();
      for (const answer of dto.answers) {
        const where = { userId_questionKey_questionnaireVersion: { userId, questionKey: answer.questionKey, questionnaireVersion: catalog.version } };
        await tx.questionnaireAnswer.upsert({ where,
          create: { userId, questionnaireVersion: catalog.version, ...answer }, update: { responseText: answer.responseText },
        });
      }
      // Validate before commit, including any unexpected persisted rows. Failure rolls back revision and all answers.
      const rows = await tx.questionnaireAnswer.findMany({ where: { userId, questionnaireVersion: catalog.version } });
      return { revision: current + 1, questionnaire: projectAnswers(rows, catalog, current + 1) };
    }));
  }
}
