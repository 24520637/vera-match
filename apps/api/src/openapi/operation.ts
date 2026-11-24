import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiSecurity } from "@nestjs/swagger";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { sessionCookieScheme } from "./configure-swagger";

export const string = { type: "string" };
export const boolean = { type: "boolean" };
export const timestamp = { type: "string", format: "date-time" };
export const revision = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const id = { type: "string", pattern: "^[A-Za-z0-9_-]{1,200}$", example: "synthetic-id" };

export function nullable(schema: SchemaObject): SchemaObject {
  return { ...schema, nullable: true };
}

export function enumeration(...values: string[]): SchemaObject {
  return { type: "string", enum: values };
}

export function array(items: SchemaObject, maxItems?: number): SchemaObject {
  return { type: "array", items, maxItems };
}

export function object(properties: Record<string, SchemaObject>, required = Object.keys(properties)): SchemaObject {
  return { type: "object", additionalProperties: false, properties, ...(required.length ? { required } : {}) };
}

export const empty = { type: "object", additionalProperties: false, example: {} };
const fields = array(object({ field: string, messages: array(string) }));
const retrySeconds = { type: "integer", minimum: 1 };
const statuses = {
  400: "Invalid request or validation failure.",
  401: "A valid active, email-verified session is required.",
  403: "Role, request origin, or resource authorization denied.",
  404: "Resource is missing or unavailable to the caller.",
  409: "Current revision, state, or idempotency conflict.",
  413: "Request exceeds the JSON parser body size limit.",
  415: "Send application/json with a supported charset and content encoding.",
  422: "Review content does not meet submission or timecode requirements.",
  429: "Request quota exceeded.",
  503: "A required service, provider, or safe processing capacity is unavailable.",
} as const;

type Status = keyof typeof statuses;
type ErrorCase = string | { code: string; details: SchemaObject; properties?: Record<string, SchemaObject> };

type Parameter = { name: string; schema: SchemaObject; description?: string; required?: boolean };
type Options = {
  summary: string;
  description: string;
  role: "MEMBER" | "EXPERT" | "MODERATOR" | "ADMIN";
  response: SchemaObject;
  status?: 200 | 201;
  body?: SchemaObject;
  path?: Parameter;
  query?: Parameter[];
  origin?: "required" | "optional";
  rejectCrossSite?: boolean;
  idempotent?: boolean;
  errors: Partial<Record<Status, ErrorCase[]>>;
};

function parserError(status: 400 | 413 | 415): SchemaObject {
  const properties = { statusCode: { type: "integer", enum: [status] }, message: string };
  return object(status === 400 ? { ...properties, error: enumeration("Bad Request") } : properties);
}

function businessError(entry: ErrorCase): SchemaObject {
  const code = typeof entry === "string" ? entry : entry.code;
  const properties: Record<string, SchemaObject> = { code: enumeration(code), message: string };
  if (code === "RATE_LIMITED") properties.retryAfterSeconds = retrySeconds;
  if (["VALIDATION_FAILED", "INVALID_OBSERVATION_TIMECODE", "REVIEW_INCOMPLETE"].includes(code)) properties.details = fields;
  if (typeof entry !== "string") Object.assign(properties, { details: entry.details }, entry.properties);
  return object(properties);
}

export const fieldError = (code: string): ErrorCase => ({ code, details: fields });

export function dataShapeError(resource: string, keys: readonly string[]): ErrorCase {
  const field = enumeration(...keys);
  return {
    code: "DATA_SHAPE_UNAVAILABLE",
    details: array(object({ field, messages: array(string) })),
    properties: {
      resource: enumeration(resource), revision,
      remediation: object({ action: enumeration("EXPLICIT_REPLACEMENT_REQUIRED"), fields: array(field) }),
    },
  };
}

export function OwnedOperation(options: Options) {
  const errors: Options["errors"] = {
    ...options.errors,
    401: ["UNAUTHENTICATED"],
    403: ["FORBIDDEN", ...(options.origin || options.rejectCrossSite ? ["ORIGIN_DENIED"] : []), ...(options.errors[403] ?? [])],
    429: ["RATE_LIMITED"],
    503: ["SESSION_STORE_UNAVAILABLE", "AUTH_CAPACITY", ...(options.errors[503] ?? [])],
  };
  if (options.body) {
    errors[413] = [];
    errors[415] = ["JSON_REQUIRED"];
  }

  return applyDecorators(
    ApiSecurity(sessionCookieScheme),
    ApiOperation({
      summary: options.summary,
      description: [
        "Requires a valid HttpOnly session cookie for an active, email-verified " + options.role + " account. The deployment configures the cookie name.",
        options.description,
        options.rejectCrossSite ? "Sec-Fetch-Site: cross-site is rejected." : "",
      ].filter(Boolean).join(" "),
    }),
    ...(options.body ? [ApiBody({ required: true, schema: options.body })] : []),
    ...(options.path ? [ApiParam({ ...options.path, required: true })] : []),
    ...(options.query ?? []).map(param => ApiQuery({ ...param, required: param.required ?? false })),
    ...(options.origin ? [ApiHeader({
      name: "Origin", required: options.origin === "required", schema: { type: "string", format: "uri" },
      description: options.origin === "required"
        ? "Required. Must match the configured browser origin."
        : "Must match the configured browser origin when supplied.",
    })] : []),
    ...(options.rejectCrossSite ? [ApiHeader({
      name: "Sec-Fetch-Site", required: false, schema: string,
      description: "Browser-supplied fetch metadata. The guard rejects cross-site.",
    })] : []),
    ...(options.idempotent ? [ApiHeader({
      name: "Idempotency-Key", required: true,
      schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$", example: "synthetic_operation_01" },
      description: "Unique client-generated key. Reuse it only to retry the same operation.",
    })] : []),
    ApiResponse({
      status: options.status ?? 200,
      description: options.status === 201 ? "Created." : "Successful response.",
      schema: options.response,
      ...(options.idempotent ? { headers: {
        "Idempotency-Replayed": { description: "Present only for a replay.", schema: enumeration("true") },
      } } : {}),
    }),
    ...Object.entries(errors).map(([statusKey, cases]) => {
      const status = Number(statusKey) as Status;
      const schemas = cases.map(businessError);
      if (status === 413 || status === 415 || (status === 400 && (options.body || options.path))) {
        schemas.push(parserError(status));
      }
      const codes = cases.map(entry => typeof entry === "string" ? entry : entry.code);
      return ApiResponse({
        status,
        description: [statuses[status], ...codes].join(" "),
        schema: schemas.length === 1 ? schemas[0] : { oneOf: schemas },
        ...(status === 429 ? { headers: {
          "Retry-After": { description: "Seconds until retry, equal to retryAfterSeconds.", schema: retrySeconds },
        } } : {}),
      });
    }),
  );
}
