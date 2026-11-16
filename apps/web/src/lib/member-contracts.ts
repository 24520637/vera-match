import { ApiError } from "./api";

export type Screen = "profile" | "questionnaire" | "preferences" | "consents";
export type Value = string | number | boolean | string[] | null;
export type Values = Record<string, Value>;
export const goals = ["long-term", "exploring"];
export const interests = ["reading", "music", "cooking", "outdoors", "sport", "travel", "creative-arts"];
export const valuesCatalog = ["kindness", "honesty", "communication", "family", "independence", "personal-growth", "community"];
export const priorities = ["relationship-goal", "values", "interests"];
export const questions = [
  { key: "relationship-intention", prompt: "What are you hoping to build in a relationship?" },
  { key: "everyday-life", prompt: "What does a good ordinary day look like for you?" },
  { key: "values-and-boundaries", prompt: "Which values and boundaries matter most to you in a relationship?" },
];
export const purposeLabels = {
  PROFILE_MATCHING: "Profile matching",
  VIDEO_STORAGE: "Video storage",
  EXPERT_VIDEO_REVIEW: "Expert video review",
  REPORT_SHARING: "Report sharing",
  VIDEO_CLAIM_MATCHING: "Video claim matching",
} as const;
export type Purpose = keyof typeof purposeLabels;
export const purposes = Object.keys(purposeLabels) as Purpose[];
export type PublishedPolicies = Partial<Record<Purpose, { version: string; locale: string; content: string }>>;
export interface ConsentState { purpose: Purpose; granted: boolean; policyVersion: string | null;
  grantedAt: string | null; revokedAt: string | null; updatedAt: string | null }
export interface ConsentSnapshot { version: number; consents: ConsentState[] }
export const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const invalid = (): never => { throw new ApiError("invalid-response", "The saved data could not be read safely. Please refresh or contact support."); };
export const defaults = (screen: Exclude<Screen, "consents">): Values => screen === "profile" ? {
  birthDate: null, occupation: null, city: null, bio: null, relationshipGoal: null, interests: null, values: null, visibilityEnabled: false,
} : screen === "preferences" ? { minAge: null, maxAge: null, relationshipGoal: null, dealBreakers: null, priorities: null }
  : Object.fromEntries(questions.map((_q, i) => [`answers.${i}.responseText`, ""]));

export function readResource(screen: Exclude<Screen, "consents">, input: unknown): { revision: number; values: Values; empty: boolean } {
  if (!object(input) || !revision(input.revision)) return invalid();
  const data = input[screen], initial = defaults(screen);
  if (screen === "questionnaire") {
    if (!object(data) || data.questionnaireVersion !== 1 || !Array.isArray(data.answers)) return invalid();
    const answers = data.answers;
    if (answers.length && (answers.length !== 3 || answers.some((answer, i) =>
      !object(answer) || answer.questionKey !== questions[i].key || typeof answer.responseText !== "string"))) return invalid();
    return { revision: input.revision, empty: !answers.length, values: Object.fromEntries(questions.map((_q, i) =>
      [`answers.${i}.responseText`, answers[i]?.responseText ?? ""])) };
  }
  if (data === null) return { revision: input.revision, values: initial, empty: true };
  if (!object(data)) return invalid();
  for (const key of Object.keys(initial)) {
    const value = data[key];
    if (key === "visibilityEnabled") { if (typeof value !== "boolean") return invalid(); }
    else if (["interests", "values", "dealBreakers", "priorities"].includes(key)) {
      if (value !== null && (!Array.isArray(value) || !value.every(item => typeof item === "string"))) return invalid();
    } else if (["minAge", "maxAge"].includes(key)) {
      if (value !== null && (!Number.isInteger(value) || (value as number) < 18 || (value as number) > 120)) return invalid();
    } else if (value !== null && typeof value !== "string") return invalid();
  }
  return { revision: input.revision, empty: false, values: Object.fromEntries(Object.keys(initial).map(key => [key, data[key] as Value])) };
}
export function resourcePayload(screen: Exclude<Screen, "consents">, revision: number, draft: Values, dirty: string[]) {
  if (screen === "questionnaire") return { expectedRevision: revision, questionnaireVersion: 1,
    answers: questions.map((q, i) => ({ questionKey: q.key, responseText: draft[`answers.${i}.responseText`] })) };
  // Never default-fill a PATCH, especially when GET failed on malformed legacy data.
  return { expectedRevision: revision, ...Object.fromEntries(dirty.map(key => [key, draft[key]])) };
}
export function readConsents(input: unknown): ConsentSnapshot {
  if (!object(input) || !revision(input.version) || !Array.isArray(input.consents) || input.consents.length !== 5) return invalid();
  if (input.consents.some((item, i) => !object(item) || item.purpose !== purposes[i] || typeof item.granted !== "boolean" ||
    ["policyVersion", "grantedAt", "revokedAt", "updatedAt"].some(key => item[key] !== null && typeof item[key] !== "string"))) return invalid();
  return input as unknown as ConsentSnapshot;
}
export function memberErrors(error: unknown, known: string[]): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const result: Record<string, string> = {};
  for (const detail of error.details) {
    if (!object(detail) || typeof detail.field !== "string" || !Array.isArray(detail.messages)) continue;
    const field = known.find(key => detail.field === key || ((detail.field as string).startsWith(`${key}.`) && /^\d+$/.test((detail.field as string).slice(key.length + 1)))) ?? "_form";
    const text = detail.messages.filter((message): message is string => typeof message === "string").join(" ");
    if (text) result[field] = [result[field], text].filter(Boolean).join(" ");
  }
  return result;
}
export function memberErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Your session needs attention. Sign in before saving; your edits have been kept.";
    if (error.status === 403) return "Access denied. Only an active, verified member can use these settings.";
    if (error.status === 409) return "Your saved data changed. Load the latest version, review it alongside your edits, then explicitly submit again.";
    if (error.status === 429) return "Too many requests. Wait for the indicated time, then try again. Nothing was automatically resubmitted.";
    return error.message;
  }
  return "The request could not be completed. Your edits have been kept.";
}
