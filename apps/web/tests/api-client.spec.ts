import { expect, test } from "@playwright/test";
import { ApiError, apiRequest, parseRetryAfter } from "../src/lib/api";

test("Retry-After supports seconds/date, validates malformed values and keeps JSON fallback", () => {
  const now = Date.UTC(2026, 10, 14);
  expect(parseRetryAfter("12", 99, now)).toBe(12);
  expect(parseRetryAfter(new Date(now + 3500).toUTCString(), 99, now)).toBe(3);
  expect(parseRetryAfter(new Date(now - 1000).toUTCString(), 99, now)).toBe(0);
  for (const header of [
    null,
    "",
    "-1",
    "1.5",
    "garbage",
    "Infinity",
    "999999999999999999999",
  ])
    expect(parseRetryAfter(header, 17, now)).toBe(17);
  expect(parseRetryAfter(null, -1, now)).toBeUndefined();
  expect(parseRetryAfter(null, "15", now)).toBeUndefined();
});

test("API client preserves credentials, no-store, existing errors and the optional 429 wait", async () => {
  const original = globalThis.fetch;
  let options: RequestInit | undefined;
  try {
    globalThis.fetch = async (_input, init) => {
      options = init;
      return new Response(
        JSON.stringify({
          code: "RATE_LIMITED",
          message: "Wait.",
          retryAfterSeconds: 40,
        }),
        { status: 429, headers: { "Retry-After": "7" } },
      );
    };
    await expect(
      apiRequest("/auth/login", { method: "POST" }),
    ).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 7,
    });
    expect(options).toMatchObject({
      credentials: "include",
      cache: "no-store",
      method: "POST",
    });
    globalThis.fetch = async () =>
      new Response("Proxy rate limit", {
        status: 429,
        headers: { "Retry-After": "11" },
      });
    await expect(apiRequest("/auth/login")).rejects.toMatchObject({
      status: 429,
      code: "HTTP_429",
      retryAfterSeconds: 11,
    });
    const controller = new AbortController();
    controller.abort();
    const aborted = new DOMException("Synthetic abort", "AbortError");
    globalThis.fetch = async () => {
      throw aborted;
    };
    await expect(
      apiRequest("/auth/me", { signal: controller.signal }),
    ).rejects.toBe(aborted);
    for (const status of [401, 403, 503]) {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            code: "EXISTING_CONTRACT",
            message: "Existing message",
            details: [{ field: "email", messages: ["Invalid email"] }],
          }),
          { status, headers: { "Retry-After": "9" } },
        );
      await expect(apiRequest("/auth/me")).rejects.toMatchObject({
        status,
        code: "EXISTING_CONTRACT",
        message: "Existing message",
        details: [{ field: "email", messages: ["Invalid email"] }],
        retryAfterSeconds: undefined,
      });
    }
    globalThis.fetch = async () => new Response(null, { status: 204 });
    expect(await apiRequest("/auth/logout")).toBeUndefined();
    globalThis.fetch = async () => {
      throw new Error("Synthetic offline");
    };
    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest("/auth/me")).rejects.toMatchObject({
      status: null,
    });
  } finally {
    globalThis.fetch = original;
  }
});
