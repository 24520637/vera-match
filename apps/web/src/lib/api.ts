export type ApiErrorKind = "http" | "network" | "aborted" | "invalid-response" | "invalid-request";

/** Transport errors carry no session side effects. Callers decide how to recover. */
export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function apiPath(path: string): string {
  const pathname = path.split("?")[0];
  if (
    !path.startsWith("/") || path.startsWith("//") ||
    /[\\#\s\u0000-\u001f\u007f]/.test(path) ||
    /%(?:2f|5c|25)/i.test(pathname)
  ) throw new ApiError("invalid-request", "Use a relative API path such as /health.");
  try {
    if (pathname.split("/").some((part) => [".", ".."].includes(decodeURIComponent(part))))
      throw new Error("Path traversal");
    decodeURIComponent(path);
  } catch {
    throw new ApiError("invalid-request", "The API path is invalid.");
  }
  return `/api${path}`;
}

function transportError(error: unknown, signal?: AbortSignal | null): ApiError {
  const aborted = signal?.aborted ||
    (error instanceof Error && error.name === "AbortError");
  return new ApiError(
    aborted ? "aborted" : "network",
    aborted ? "The request was cancelled." : "The API could not be reached.",
  );
}

/** Browser transport. Relative URLs do not forward incoming cookies during SSR. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = apiPath(path);
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...init,
      credentials: "same-origin",
      redirect: "error",
    });
  } catch (error) {
    throw transportError(error, init.signal);
  }
  if (response.ok) return response;

  let envelope: Record<string, unknown> = {};
  try {
    const value: unknown = await response.json();
    if (value && typeof value === "object" && !Array.isArray(value))
      envelope = value as Record<string, unknown>;
  } catch (error) {
    const failure = transportError(error, init.signal);
    if (failure.kind === "aborted") throw failure;
    // Preserve HTTP status for non-cancellation body parsing failures.
  }
  const fallback = response.status === 401 ? "Authentication is required."
    : response.status === 403 ? "Access is denied."
    : `The API request failed (${response.status}).`;
  const message = typeof envelope.message === "string" ? envelope.message
    : Array.isArray(envelope.message) && envelope.message.every((item) => typeof item === "string")
      ? envelope.message.join(" ") : fallback;
  throw new ApiError("http", message, response.status,
    typeof envelope.code === "string" ? envelope.code : undefined, envelope.details);
}

/** T describes the expected contract; it does not perform runtime schema validation. */
export async function apiJson<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T | undefined> {
  const { json, ...request } = init;
  const headers = new Headers(request.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (json !== undefined) {
    if (request.body != null)
      throw new ApiError("invalid-request", "Choose either json or body for the request.");
    try {
      request.body = JSON.stringify(json);
    } catch {
      throw new ApiError("invalid-request", "The request body is not JSON serializable.");
    }
    if (request.body === undefined)
      throw new ApiError("invalid-request", "The request body is not JSON serializable.");
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }
  const response = await apiFetch(path, { ...request, headers });
  if (response.status === 204 || response.status === 205 || request.method?.toUpperCase() === "HEAD")
    return undefined;
  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    throw transportError(error, request.signal);
  }
  if (!body.trim()) return undefined;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ApiError("invalid-response", "The API returned invalid JSON.", response.status);
  }
}
