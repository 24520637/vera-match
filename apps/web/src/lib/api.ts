export class ApiError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
    message: string,
    readonly details?: { field: string; messages: string[] }[],
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
/** Retry-After supports delta-seconds and HTTP dates; malformed headers fall back to JSON. */
export function parseRetryAfter(
  header: string | null,
  fallback: unknown,
  now = Date.now(),
): number | undefined {
  const valid = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2147483647;
  if (header !== null) {
    const text = header.trim();
    if (/^\d+$/.test(text) && valid(Number(text))) return Number(text);
    if (/^[A-Za-z]{3}, /.test(text)) {
      const date = Date.parse(text);
      const seconds = Math.max(0, Math.ceil((date - now) / 1000));
      if (Number.isFinite(date) && valid(seconds)) return seconds;
    }
  }
  return valid(fallback) ? fallback : undefined;
}
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000/api";
export async function apiFetch(path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(
      null,
      "NETWORK_UNAVAILABLE",
      "The service could not be reached. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
      details?: { field: string; messages: string[] }[];
      retryAfterSeconds?: unknown;
    };
    throw new ApiError(
      response.status,
      body.code ?? `HTTP_${response.status}`,
      typeof body.message === "string"
        ? body.message
        : "The request could not be completed. Try again.",
      body.details,
      response.status === 429
        ? parseRetryAfter(
            response.headers.get("Retry-After"),
            body.retryAfterSeconds,
          )
        : undefined,
    );
  }
  return response;
}
export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(path, init);
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
export const postAuth = <T>(path: string, body: object) =>
  apiRequest<T>(`/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
