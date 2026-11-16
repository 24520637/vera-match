import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { QuestionnaireAnswer } from "@prisma/client";
import { invalidRequest, normalizeText } from "../profile/profile.validation";
import { QuestionCatalog, QuestionnaireCatalog } from "./questionnaire.catalog";

export interface QuestionnairePutDto {
  expectedRevision: number;
  questionnaireVersion: number;
  answers: { questionKey: string; responseText: string }[];
}
export interface QuestionnaireReadDto {
  questionnaireVersion: number;
  answers: { questionKey: string; responseText: string; updatedAt: string }[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const validText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && [...value].length <= 2000;

export function selectCatalog(value: unknown, registry: QuestionnaireCatalog): QuestionCatalog {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || !registry.find(value as number)) {
    return invalidRequest([{ field: "questionnaireVersion", messages: ["Choose a supported questionnaire version."] }]);
  }
  return registry.find(value as number)!;
}

export function parseQuestionnaireQuery(query: Record<string, unknown>, registry: QuestionnaireCatalog) {
  if (Object.keys(query).some(key => key !== "questionnaireVersion")) {
    return invalidRequest([{ field: "_form", messages: ["Remove unsupported query parameters."] }]);
  }
  const value = query.questionnaireVersion;
  if (value === undefined) return selectCatalog(registry.currentVersion, registry);
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return invalidRequest([{ field: "questionnaireVersion", messages: ["Use an integer catalog version."] }]);
  }
  return selectCatalog(Number(value), registry);
}

export function parseQuestionnairePut(input: unknown, registry: QuestionnaireCatalog): QuestionnairePutDto {
  if (!object(input)) return invalidRequest([{ field: "_form", messages: ["Send a questionnaire object."] }]);
  const errors: { field: string; messages: string[] }[] = [];
  if (Object.keys(input).some(key => !["expectedRevision", "questionnaireVersion", "answers"].includes(key))) {
    errors.push({ field: "_form", messages: ["Remove unsupported fields."] });
  }
  if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
    errors.push({ field: "expectedRevision", messages: ["A nonnegative safe integer revision is required."] });
  }
  if (errors.length) return invalidRequest(errors);
  const catalog = selectCatalog(input.questionnaireVersion, registry);
  if (catalog.retired) throw new ConflictException({
    code: "QUESTIONNAIRE_VERSION_RETIRED", message: "This questionnaire version is read-only.",
    details: [{ field: "_form", messages: ["Reload the current questionnaire before submitting."] }],
  });
  const answers: QuestionnairePutDto["answers"] = [];
  const seen = new Set<string>();
  if (!Array.isArray(input.answers) || input.answers.length !== 3) {
    return invalidRequest([{ field: "answers", messages: ["Submit exactly three answers."] }]);
  }
  input.answers.forEach((answer: unknown, index: number) => {
    const path = `answers.${index}`;
    if (!object(answer)) { errors.push({ field: path, messages: ["Send an answer object."] }); return; }
    if (Object.keys(answer).some(key => !["questionKey", "responseText"].includes(key))) {
      errors.push({ field: path, messages: ["Remove unsupported answer fields."] });
    }
    if (typeof answer.questionKey !== "string" || !catalog.questions.some(question => question.key === answer.questionKey) || seen.has(answer.questionKey)) {
      errors.push({ field: `${path}.questionKey`, messages: ["Choose each canonical question exactly once."] });
    } else seen.add(answer.questionKey);
    const responseText = typeof answer.responseText === "string" ? normalizeText(answer.responseText) : answer.responseText;
    if (!validText(responseText)) errors.push({ field: `${path}.responseText`, messages: ["Use 1-2000 Unicode code points of nonblank text."] });
    answers.push({ questionKey: answer.questionKey as string, responseText: responseText as string });
  });
  if (errors.length) return invalidRequest(errors);
  return { expectedRevision: input.expectedRevision as number, questionnaireVersion: catalog.version,
    answers: catalog.questions.map(question => answers.find(answer => answer.questionKey === question.key)!) };
}

export function legacyQuestionnaire(revision: number, support = false): never {
  throw new ServiceUnavailableException({
    code: "DATA_SHAPE_UNAVAILABLE", message: "Stored questionnaire data needs review before this change can be saved.",
    resource: "questionnaire", revision,
    details: [{ field: "answers", messages: [support
      ? "Stored answers require a separately reviewed support remediation; they cannot be removed by this request."
      : "Explicitly replace all three answers before saving."] }],
    remediation: { action: "EXPLICIT_REPLACEMENT_REQUIRED", fields: ["answers"] },
  });
}

export function projectAnswers(rows: QuestionnaireAnswer[], catalog: QuestionCatalog, revision: number): QuestionnaireReadDto {
  if (rows.length === 0) return { questionnaireVersion: catalog.version, answers: [] };
  if (rows.some(row => !catalog.questions.some(question => question.key === row.questionKey))) return legacyQuestionnaire(revision, true);
  if (rows.length !== 3 || rows.some(row => !validText(row.responseText) || normalizeText(row.responseText) !== row.responseText)) {
    return legacyQuestionnaire(revision);
  }
  return { questionnaireVersion: catalog.version, answers: catalog.questions.map(question => {
    const row = rows.find(answer => answer.questionKey === question.key)!;
    return { questionKey: row.questionKey, responseText: row.responseText, updatedAt: row.updatedAt.toISOString() };
  }) };
}
