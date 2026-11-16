import { ServiceUnavailableException } from "@nestjs/common";
import { invalidRequest } from "../profile/profile.validation";

export const preferenceFields = ["minAge", "maxAge", "relationshipGoal", "dealBreakers", "priorities"] as const;
export type PreferenceField = typeof preferenceFields[number];
export type PreferencesData = Record<PreferenceField, unknown>;
export interface PreferencesPatchDto {
  expectedRevision: number;
  minAge?: number | null;
  maxAge?: number | null;
  relationshipGoal?: string | null;
  dealBreakers?: string[] | null;
  priorities?: string[] | null;
}
export interface PreferencesReadDto {
  minAge: number | null;
  maxAge: number | null;
  relationshipGoal: string | null;
  dealBreakers: string[] | null;
  priorities: string[] | null;
  updatedAt: string;
}
// These IDs are exact and case-sensitive, not free text to normalize or aliases.
export const preferenceCatalog = {
  goals: ["long-term", "exploring"],
  dealBreakers: ["different-relationship-goal"],
  // null means this default order; [] means no optional ranking criteria.
  // Persist the submitted order; do not sort, assign weights or infer hard filters.
  priorities: ["relationship-goal", "values", "interests"],
} as const;
type Detail = { field: string; messages: string[] };

export function preferenceFieldErrors(field: PreferenceField, value: unknown): Detail[] {
  const invalid = (): Detail[] => [{ field, messages: ["Use a valid value for this field."] }];
  if (value === null) return [];
  if (field === "minAge" || field === "maxAge") {
    return Number.isInteger(value) && (value as number) >= 18 && (value as number) <= 120 ? [] : invalid();
  }
  if (field === "relationshipGoal") {
    return typeof value === "string" && (preferenceCatalog.goals as readonly string[]).includes(value) ? [] : invalid();
  }
  const catalog = preferenceCatalog[field];
  if (!Array.isArray(value) || value.length > catalog.length) return invalid();
  const errors: Detail[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (typeof item !== "string" || !(catalog as readonly string[]).includes(item) || seen.has(item)) {
      errors.push({ field: `${field}.${index}`, messages: ["Choose each supported catalog value at most once."] });
    }
    if (typeof item === "string") seen.add(item);
  });
  return errors;
}

export function parsePreferencesPatch(input: unknown): PreferencesPatchDto {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalidRequest([{ field: "_form", messages: ["Send a preferences object."] }]);
  }
  const body = input as Record<string, unknown>;
  const errors: Detail[] = [];
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
    errors.push({ field: "expectedRevision", messages: ["A nonnegative safe integer revision is required."] });
  }
  if (Object.keys(body).some(key => key !== "expectedRevision" && !preferenceFields.includes(key as PreferenceField))) {
    errors.push({ field: "_form", messages: ["Remove unsupported fields."] });
  }
  const present = preferenceFields.filter(field => Object.prototype.hasOwnProperty.call(body, field));
  if (!present.length) errors.push({ field: "_form", messages: ["Submit at least one preference field."] });
  for (const field of present) errors.push(...preferenceFieldErrors(field, body[field]));
  if (errors.length) return invalidRequest(errors);
  return Object.fromEntries([ ["expectedRevision", body.expectedRevision], ...present.map(field => [field, body[field]]) ]) as unknown as PreferencesPatchDto;
}

export function invertedRange(data: PreferencesData) {
  return typeof data.minAge === "number" && typeof data.maxAge === "number" && data.minAge > data.maxAge;
}

export function legacyPreferences(fields: PreferenceField[], revision: number): never {
  throw new ServiceUnavailableException({
    code: "DATA_SHAPE_UNAVAILABLE", message: "Stored preferences data needs review before this change can be saved.",
    resource: "preferences", revision,
    details: fields.map(field => ({ field, messages: ["Explicitly replace or clear this field before saving."] })),
    remediation: { action: "EXPLICIT_REPLACEMENT_REQUIRED", fields },
  });
}

export function validatePreferencesState(data: PreferencesData, revision: number, original?: PreferencesData, patch?: PreferencesPatchDto) {
  const malformed = preferenceFields.filter(field => preferenceFieldErrors(field, data[field]).length > 0);
  if (malformed.length) return legacyPreferences(malformed, revision);
  if (invertedRange(data)) {
    const has = (field: "minAge" | "maxAge") => !!patch && Object.prototype.hasOwnProperty.call(patch, field);
    if ((has("minAge") && has("maxAge")) || ((has("minAge") || has("maxAge")) && original && !invertedRange(original))) {
      return invalidRequest([{ field: "maxAge", messages: ["Maximum age must be greater than or equal to minimum age."] }]);
    }
    return legacyPreferences(["minAge", "maxAge"], revision);
  }
}
