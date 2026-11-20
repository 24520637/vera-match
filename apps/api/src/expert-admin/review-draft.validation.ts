import { BadRequestException, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import { ObservationCategory } from "@prisma/client";

const MAX_INT = 2147483647;

function invalid(field: string, message: string): never {
  throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Check the draft fields.",
    details: [{ field, messages: [message] }] });
}

function timecode(field: string): never {
  throw new UnprocessableEntityException({ code: "INVALID_OBSERVATION_TIMECODE",
    message: "Observation times must be ordered whole milliseconds within the verified video duration.",
    details: [{ field, messages: ["Check the observation time range."] }] });
}

function record(value: unknown, keys: readonly string[], field = "_form"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field, "Send a JSON object.");
  if (Object.keys(value).some(key => !keys.includes(key))) invalid(field, "Unexpected fields.");
  return value as Record<string, unknown>;
}

export function reviewId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) invalid("id", "Send a valid identifier.");
  return value;
}

function text(value: unknown, field: string, required: true): string;
function text(value: unknown, field: string, required: false): string | null;
function text(value: unknown, field: string, required: boolean) {
  if (value === null && !required) return null;
  if (typeof value !== "string" || value.includes("\u0000") || (required && !value.trim()))
    invalid(field, required ? "Enter explicit text." : "Send text or null.");
  return value;
}

function version(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_INT)
    invalid("expectedVersion", "Send the current draft version.");
  return value;
}

export function observation(value: unknown, field: string) {
  const row = record(value, ["category", "startMs", "endMs", "observation", "context"], field);
  if (typeof row.category !== "string" || !Object.values(ObservationCategory).includes(row.category as ObservationCategory))
    invalid(field + ".category", "Select one of the five observation categories.");
  const { startMs, endMs } = row;
  if (typeof startMs !== "number" || !Number.isInteger(startMs) || startMs < 0 || startMs > MAX_INT) timecode(field + ".startMs");
  if (typeof endMs !== "number" || !Number.isInteger(endMs) || endMs < startMs || endMs > MAX_INT) timecode(field + ".endMs");
  return { category: row.category as ObservationCategory, startMs, endMs,
    observation: text(row.observation, field + ".observation", true),
    context: text(row.context, field + ".context", true) };
}

export function draftPatch(value: unknown) {
  const row = record(value, ["expectedVersion", "summary", "limitations", "observations"]);
  if (row.observations !== undefined && !Array.isArray(row.observations)) invalid("observations", "Send an array.");
  if (row.summary === undefined && row.limitations === undefined && row.observations === undefined)
    invalid("_form", "Supply a draft change.");
  return { expectedVersion: version(row.expectedVersion),
    summary: row.summary === undefined ? undefined : text(row.summary, "summary", false),
    limitations: row.limitations === undefined ? undefined : text(row.limitations, "limitations", false),
    observations: row.observations?.map((item, index) => observation(item, `observations.${index}`)) };
}

export function observationPost(value: unknown) {
  const row = record(value, ["expectedVersion", "observation"]);
  return { expectedVersion: version(row.expectedVersion), observation: observation(row.observation, "observation") };
}

export function requireEmpty(value: unknown) { record(value, []); }

export function requireDurationBounds<T extends { startMs: number; endMs: number }>(
  rows: readonly T[], durationMs: number | null, prefix: "observations" | "observation",
) {
  if (!rows.length) return;
  if (durationMs === null || !Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_INT)
    throw new ServiceUnavailableException({ code: "REVIEW_DURATION_UNAVAILABLE",
      message: "Verified video duration is unavailable. Timecoded observations cannot be saved." });
  for (const [index, row] of rows.entries()) {
    const field = prefix === "observations" ? `observations.${index}` : prefix;
    if (row.endMs > durationMs) timecode(field + ".endMs");
  }
}
