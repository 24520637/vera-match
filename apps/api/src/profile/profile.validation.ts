import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";

export const profileFields = ["birthDate", "occupation", "city", "bio", "relationshipGoal", "interests", "values", "visibilityEnabled"] as const;
export type ProfileField = typeof profileFields[number];
export type ProfileData = Record<ProfileField, unknown>;
export type ProfilePatch = Partial<ProfileData> & { expectedRevision: number };
type Detail = { field: string; messages: string[] };
const goals = ["long-term", "exploring"];
const interests = ["reading", "music", "cooking", "outdoors", "sport", "travel", "creative-arts"];
const values = ["kindness", "honesty", "communication", "family", "independence", "personal-growth", "community"];

export function utcAge(birth: Date, today = new Date()): number {
  const year = today.getUTCFullYear();
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const feb29 = birth.getUTCMonth() === 1 && birth.getUTCDate() === 29 && !leap;
  const month = feb29 ? 2 : birth.getUTCMonth();
  const day = feb29 ? 1 : birth.getUTCDate();
  return year - birth.getUTCFullYear() -
    Number(today.getUTCMonth() < month || (today.getUTCMonth() === month && today.getUTCDate() < day));
}

function validDate(value: unknown, today: Date) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && utcAge(date, today) >= 18;
}

export function normalizeText(value: string) {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

function fieldErrors(field: ProfileField, value: unknown, today: Date): Detail[] {
  const error = (path = field): Detail[] => [{ field: path, messages: ["Use a valid value for this field."] }];
  if (field === "visibilityEnabled") return typeof value === "boolean" ? [] : error();
  if (value === null) return [];
  if (field === "birthDate") return validDate(value, today) ? [] : error();
  if (field === "interests" || field === "values") {
    if (!Array.isArray(value) || value.length > 7) return error();
    const catalog = field === "interests" ? interests : values;
    const details: Detail[] = [];
    const seen = new Set<string>();
    value.forEach((item, index) => {
      if (typeof item !== "string" || !catalog.includes(item) || seen.has(item)) {
        details.push({ field: `${field}.${index}`, messages: ["Choose a distinct supported catalog value."] });
      }
      if (typeof item === "string") seen.add(item);
    });
    return details;
  }
  if (typeof value !== "string") return error();
  if (field === "relationshipGoal") return goals.includes(value) ? [] : error();
  return value.length > 0 && normalizeText(value) === value &&
    [...value].length <= (field === "bio" ? 2000 : 120) ? [] : error();
}

export function invalidRequest(details: Detail[]): never {
  throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Check the submitted fields.", details });
}

export function parseProfilePatch(input: unknown, today = new Date()): ProfilePatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalidRequest([{ field: "_form", messages: ["Send a profile object."] }]);
  }
  const body = input as Record<string, unknown>;
  const details: Detail[] = [];
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
    details.push({ field: "expectedRevision", messages: ["A nonnegative safe integer revision is required."] });
  }
  if (Object.keys(body).some(key => key !== "expectedRevision" && !profileFields.includes(key as ProfileField))) {
    details.push({ field: "_form", messages: ["Remove unsupported fields."] });
  }
  const patch: ProfilePatch = { expectedRevision: body.expectedRevision as number };
  let changes = 0;
  for (const field of profileFields) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    changes++;
    let value = body[field];
    if (["occupation", "city", "bio"].includes(field) && typeof value === "string") value = normalizeText(value);
    details.push(...fieldErrors(field, value, today));
    patch[field] = value;
  }
  if (!changes) details.push({ field: "_form", messages: ["Submit at least one profile field."] });
  if (details.length) return invalidRequest(details);
  return patch;
}

export function assertStoredProfile(data: ProfileData, revision: number, today = new Date()) {
  const fields = profileFields.filter(field => fieldErrors(field, data[field], today).length > 0);
  if (fields.length) {
    throw new ServiceUnavailableException({
      code: "DATA_SHAPE_UNAVAILABLE",
      message: "Stored profile data needs review before this change can be saved.",
      resource: "profile", revision,
      details: fields.map(field => ({ field, messages: ["Explicitly replace or clear this field before saving."] })),
      remediation: { action: "EXPLICIT_REPLACEMENT_REQUIRED", fields },
    });
  }
}
