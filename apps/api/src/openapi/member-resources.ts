import { preferenceCatalog, preferenceFields } from "../preferences/preferences.validation";
import { profileFields } from "../profile/profile.validation";
import { QuestionnaireCatalog } from "../questionnaire/questionnaire.catalog";
import { array, boolean, dataShapeError, enumeration, fieldError, nullable, object, OwnedOperation, revision, string, timestamp } from "./operation";

const resourceConflict = fieldError("RESOURCE_REVISION_CONFLICT");
const invalid = ["VALIDATION_FAILED"];
const memberRead = { role: "MEMBER" } as const;
const memberWrite = { ...memberRead, origin: "required" } as const;

const catalogList = (keys: readonly string[]) => nullable({ ...array(enumeration(...keys), keys.length), uniqueItems: true });
const normalizedText = (limit: number) => ({
  type: "string",
  description: "After NFC normalization, newline normalization, and trimming, 1 to " + limit + " Unicode code points.",
});
const storedText = (limit: number) => ({ ...string, minLength: 1, maxLength: limit });
const goal = { ...nullable(enumeration(...preferenceCatalog.goals)), enum: [...preferenceCatalog.goals, null] };

const profileFieldsSchema = {
  birthDate: nullable({ type: "string", format: "date", pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}$",
    description: "Valid calendar date in YYYY-MM-DD format. The member must be at least 18 by UTC date." }),
  occupation: nullable(storedText(120)), city: nullable(storedText(120)), bio: nullable(storedText(2000)),
  relationshipGoal: goal,
  interests: catalogList(["reading", "music", "cooking", "outdoors", "sport", "travel", "creative-arts"]),
  values: catalogList(["kindness", "honesty", "communication", "family", "independence", "personal-growth", "community"]),
  visibilityEnabled: boolean,
};
const profile = object({ ...profileFieldsSchema, updatedAt: timestamp });
const profileUnavailable = ["PROFILE_STORE_UNAVAILABLE", dataShapeError("profile", profileFields)];

export const ApiReadProfile = () => OwnedOperation({
  ...memberRead, summary: "Read my profile",
  description: "Returns the signed-in member’s profile and its revision. If no profile exists, the profile field is null. The read does not provision a profile.",
  response: { ...object({ revision, profile: nullable(profile) }), example: { revision: 0, profile: null } },
  errors: { 400: invalid, 503: profileUnavailable },
});

export const ApiUpdateProfile = () => OwnedOperation({
  ...memberWrite, summary: "Update my profile",
  description: "Send the current revision and at least one profile field. Omitted fields keep their values. Null clears nullable fields. Visibility is a literal boolean.",
  body: {
    ...object({ expectedRevision: revision, ...profileFieldsSchema, occupation: nullable(normalizedText(120)),
      city: nullable(normalizedText(120)), bio: nullable(normalizedText(2000)) }, ["expectedRevision"]),
    minProperties: 2, example: { expectedRevision: 0, city: "Da Nang", interests: ["reading"], visibilityEnabled: false },
  },
  response: object({ revision, profile }),
  errors: { 400: invalid, 409: [resourceConflict], 503: [...profileUnavailable, "PROFILE_REVISION_EXHAUSTED"] },
});

const age = nullable({ type: "integer", minimum: 18, maximum: 120 });
const preferenceFieldsSchema = {
  minAge: age, maxAge: age, relationshipGoal: goal, dealBreakers: catalogList(preferenceCatalog.dealBreakers),
  priorities: { ...catalogList(preferenceCatalog.priorities),
    description: "Order is significant. Null uses the default catalog order. An empty array disables optional ranking criteria." },
};
const preferences = object({ ...preferenceFieldsSchema, updatedAt: timestamp });
const preferencesUnavailable = ["PREFERENCES_STORE_UNAVAILABLE", dataShapeError("preferences", preferenceFields)];

export const ApiReadPreferences = () => OwnedOperation({
  ...memberRead, summary: "Read my matching preferences",
  description: "Returns the signed-in member’s preferences and their revision. If no preferences exist, the preferences field is null. The read does not provision preferences.",
  response: { ...object({ revision, preferences: nullable(preferences) }), example: { revision: 0, preferences: null } },
  errors: { 400: invalid, 503: preferencesUnavailable },
});

export const ApiUpdatePreferences = () => OwnedOperation({
  ...memberWrite, summary: "Update my matching preferences",
  description: "Send the current revision and at least one preference field. Omitted fields keep their values and null clears a value. If both resulting age bounds exist, the minimum cannot exceed the maximum.",
  body: {
    ...object({ expectedRevision: revision, ...preferenceFieldsSchema }, ["expectedRevision"]),
    minProperties: 2, example: { expectedRevision: 0, minAge: 25, maxAge: 36, priorities: ["values", "interests"] },
  },
  response: object({ revision, preferences }),
  errors: { 400: invalid, 409: [resourceConflict], 503: [...preferencesUnavailable, "PREFERENCES_REVISION_EXHAUSTED"] },
});

const catalog = new QuestionnaireCatalog();
const currentVersion = catalog.currentVersion;
const keys = catalog.find(currentVersion)!.questions.map(question => question.key);
const questionnaireVersion = { type: "integer", enum: [currentVersion] };
const questionKey = enumeration(...keys);
const savedAnswers = { ...array(object({ questionKey, responseText: storedText(2000), updatedAt: timestamp }), keys.length), minItems: keys.length };
const questionnaireUnavailable = ["QUESTIONNAIRE_STORE_UNAVAILABLE", dataShapeError("questionnaire", ["answers"])];

export const ApiReadQuestionnaire = () => OwnedOperation({
  ...memberRead, summary: "Read my questionnaire answers",
  description: "Returns the current questionnaire revision and the selected catalog’s saved answers, in catalog order. The array is empty before the first save. The read does not initialize answers.",
  query: [{ name: "questionnaireVersion", schema: { ...questionnaireVersion, default: currentVersion },
    description: "Defaults to the current catalog version. Version 1 is currently supported." }],
  response: {
    ...object({ revision, questionnaire: object({
      questionnaireVersion, answers: { type: "array", items: savedAnswers.items, oneOf: [savedAnswers, { type: "array", maxItems: 0, items: {} }] },
    }) }),
    example: { revision: 0, questionnaire: { questionnaireVersion: currentVersion, answers: [] } },
  },
  errors: { 400: invalid, 503: questionnaireUnavailable },
});

export const ApiUpdateQuestionnaire = () => OwnedOperation({
  ...memberWrite, summary: "Replace my questionnaire answers",
  description: "Replaces the complete answer set for the selected catalog under the current questionnaire revision. Supply each of the three catalog keys exactly once. The response uses catalog order.",
  body: {
    ...object({ expectedRevision: revision, questionnaireVersion,
      answers: { ...array(object({ questionKey, responseText: normalizedText(2000) }), keys.length), minItems: keys.length } }),
    example: {
      expectedRevision: 0, questionnaireVersion: currentVersion, answers: [
        { questionKey: "relationship-intention", responseText: "A long-term partnership." },
        { questionKey: "everyday-life", responseText: "Time together and time outdoors." },
        { questionKey: "values-and-boundaries", responseText: "Kindness and mutual respect." },
      ],
    },
  },
  response: object({ revision, questionnaire: object({ questionnaireVersion, answers: savedAnswers }) }),
  errors: { 400: invalid, 409: [resourceConflict], 503: [...questionnaireUnavailable, "QUESTIONNAIRE_REVISION_EXHAUSTED"] },
});
