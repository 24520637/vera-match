import { HttpException } from "@nestjs/common";
import { QuestionnaireCatalog } from "./questionnaire.catalog";
import { parseQuestionnairePut, parseQuestionnaireQuery } from "./questionnaire.validation";

const registry = new QuestionnaireCatalog();
const valid = () => ({ expectedRevision: 0, questionnaireVersion: 1,
  answers: registry.find(1)!.questions.map(question => ({ questionKey: question.key, responseText: "Synthetic answer" })) });
function error(input: unknown) {
  try { parseQuestionnairePut(input, registry); }
  catch (caught) { return caught as HttpException; }
  throw new Error("Expected validation failure");
}

describe("C021 questionnaire validation/catalog", () => {
  it("freezes the three approved keys, full prompts and stable response order", () => {
    expect(registry.find(1)!.questions.map(question => question.prompt)).toEqual([
      "What are you hoping to build in a relationship?", "What does a good ordinary day look like for you?",
      "Which values and boundaries matter most to you in a relationship?",
    ]);
    const input = valid();
    input.answers.reverse();
    input.answers[0].responseText = " Cafe\u0301\r\nline ";
    const dto = parseQuestionnairePut(input, registry);
    expect(dto.answers.map(answer => answer.questionKey)).toEqual(["relationship-intention", "everyday-life", "values-and-boundaries"]);
    expect(dto.answers[2].responseText).toBe("Café\nline");
  });
  it.each([null, [], {}, { ...valid(), expectedRevision: "0" }, { ...valid(), expectedRevision: -1 },
    { ...valid(), questionnaireVersion: "1" }, { ...valid(), questionnaireVersion: 99 },
    { ...valid(), answers: null }, { ...valid(), answers: [] }, { ...valid(), answers: valid().answers.slice(0, 2) },
    { ...valid(), userId: "another-member" },
  ])("rejects invalid DTO without coercion: %j", input => {
    const caught = error(input);
    expect(caught.getStatus()).toBe(400);
    expect(caught.getResponse()).toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it("validates duplicates, unknown keys, extra fields and text at nested paths", () => {
    const input = valid();
    input.answers[1] = { questionKey: input.answers[0].questionKey, responseText: " " };
    expect(error(input).getResponse()).toMatchObject({ details: [
      { field: "answers.1.questionKey" }, { field: "answers.1.responseText" },
    ] });
    input.answers[1] = { questionKey: "PENDING_KEY_1", responseText: "x" };
    expect(error(input).getStatus()).toBe(400);
    input.answers[1] = { questionKey: "everyday-life", responseText: "😀".repeat(2000) };
    expect(parseQuestionnairePut(input, registry).answers[1].responseText).toHaveLength(4000);
    input.answers[1].responseText += "x";
    expect(error(input).getResponse()).toMatchObject({ details: [{ field: "answers.1.responseText" }] });
    expect(error({ ...valid(), answers: [{ ...valid().answers[0], questionnaireVersion: 2 }, ...valid().answers.slice(1)] }).getStatus()).toBe(400);
  });
  it("validates selectors and does not treat arbitrary legacy versions as approved", () => {
    expect(parseQuestionnaireQuery({}, registry).version).toBe(1);
    expect(parseQuestionnaireQuery({ questionnaireVersion: "1" }, registry).version).toBe(1);
    for (const query of [{ questionnaireVersion: "0" }, { questionnaireVersion: "2" },
      { questionnaireVersion: ["1", "1"] }, { questionnaireVersion: "1.0" }, { userId: "injected" }]) {
      expect(() => parseQuestionnaireQuery(query, registry)).toThrow();
    }
  });
});
