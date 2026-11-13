import { test as base, expect } from "@playwright/test";
import { ApiError, apiFetch, apiJson } from "../src/lib/api";

type Transport = {
  calls: { url: RequestInfo | URL; init?: RequestInit }[];
  respond: () => Promise<Response>;
};

const test = base.extend<{ transport: Transport }>({
  transport: async ({}, use) => {
    const original = globalThis.fetch;
    const transport: Transport = {
      calls: [],
      respond: async () => Response.json({ status: "ok" }),
    };
    globalThis.fetch = async (url, init) => {
      transport.calls.push({ url, init });
      return transport.respond();
    };
    try { await use(transport); }
    finally { globalThis.fetch = original; }
  },
});

test("JSON and raw responses use the API prefix and same-origin credentials", async ({ transport }) => {
  const controller = new AbortController();
  expect(await apiJson<{ status: string }>("/health?probe=1", {
    signal: controller.signal, credentials: "include",
  })).toEqual({ status: "ok" });
  expect(transport.calls[0].url).toBe("/api/health?probe=1");
  expect(transport.calls[0].init).toMatchObject({
    credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
  });
  const response = await apiFetch("/health");
  expect(response).toBeInstanceOf(Response);
  expect(await response.json()).toEqual({ status: "ok" });
});

for (const status of [400, 401, 403, 409, 422, 500]) {
  test(`HTTP ${status} preserves status and error-envelope fields`, async ({ transport }) => {
    transport.respond = async () => Response.json({
      code: "EXAMPLE_ERROR", message: "Example failure.", details: { field: "example" },
    }, { status });
    await expect(apiJson("/example")).rejects.toMatchObject({
      name: "ApiError", kind: "http", status, code: "EXAMPLE_ERROR",
      message: "Example failure.", details: { field: "example" },
    });
    expect(transport.calls).toHaveLength(1);
  });
}

test("Nest validation arrays and non-JSON HTTP failures remain HTTP errors", async ({ transport }) => {
  transport.respond = async () => Response.json({ message: ["First error.", "Second error."] }, { status: 400 });
  await expect(apiFetch("/example")).rejects.toMatchObject({ message: "First error. Second error.", status: 400 });
  for (const body of ["<html>Unavailable</html>", "{", "", "null"]) {
    transport.respond = async () => new Response(body, { status: 500 });
    await expect(apiJson("/example")).rejects.toMatchObject({ kind: "http", status: 500 });
  }
});

test("network failure and cancellation are distinct from HTTP authentication errors", async ({ transport }) => {
  transport.respond = async () => { throw new TypeError("Connection failed"); };
  await expect(apiFetch("/example")).rejects.toMatchObject({ kind: "network", status: undefined });
  const controller = new AbortController();
  controller.abort();
  await expect(apiFetch("/example", { signal: controller.signal })).rejects.toMatchObject({ kind: "aborted" });
  transport.respond = async () => { throw new DOMException("Cancelled", "AbortError"); };
  await expect(apiFetch("/example")).rejects.toMatchObject({ kind: "aborted" });
});

test("cancellation while reading an HTTP error body remains aborted", async ({ transport }) => {
  for (const status of [401, 403, 500]) {
    transport.respond = async () => new Response(new ReadableStream({
      start(controller) {
        controller.error(new DOMException("Cancelled during body read", "AbortError"));
      },
    }), { status });
    await expect(apiJson("/example")).rejects.toMatchObject({
      kind: "aborted", status: undefined,
    });
  }

  // A custom abort reason need not be an AbortError; the signal is authoritative.
  const controller = new AbortController();
  transport.respond = async () => new Response(new ReadableStream({
    pull(stream) {
      controller.abort(new Error("Custom cancellation reason"));
      stream.error(controller.signal.reason);
    },
  }), { status: 401 });
  await expect(apiFetch("/example", { signal: controller.signal })).rejects.toMatchObject({
    kind: "aborted", status: undefined,
  });
});

test("undefined JSON serialization rejects mutations before fetch", async ({ transport }) => {
  const values = [() => "example", Symbol("example"), { toJSON: () => undefined }];
  for (const json of values) {
    await expect(apiJson("/example", { method: "POST", json })).rejects.toMatchObject({
      name: "ApiError", kind: "invalid-request",
      message: "The request body is not JSON serializable.",
    });
  }
  expect(transport.calls).toHaveLength(0);
});

test("empty and HEAD responses return undefined; malformed success JSON is explicit", async ({ transport }) => {
  for (const status of [204, 205]) {
    transport.respond = async () => new Response(null, { status });
    expect(await apiJson("/example")).toBeUndefined();
  }
  transport.respond = async () => new Response("");
  expect(await apiJson("/example")).toBeUndefined();
  expect(await apiJson("/example", { method: "HEAD" })).toBeUndefined();
  transport.respond = async () => new Response("<html>Not JSON</html>");
  await expect(apiJson("/example")).rejects.toMatchObject({ kind: "invalid-response", status: 200 });
});

test("JSON requests preserve caller headers and multipart bodies keep their boundary", async ({ transport }) => {
  await apiJson("/example", { method: "POST", json: { example: true }, headers: { "X-CSRF-Token": "synthetic-test-value" } });
  const jsonRequest = transport.calls[0].init!;
  expect(jsonRequest.body).toBe('{"example":true}');
  expect(new Headers(jsonRequest.headers).get("Content-Type")).toBe("application/json");
  expect(new Headers(jsonRequest.headers).get("X-CSRF-Token")).toBe("synthetic-test-value");
  const body = new FormData();
  body.set("example", "fictional");
  await apiJson("/example", { method: "POST", body });
  expect(transport.calls[1].init!.body).toBe(body);
  expect(new Headers(transport.calls[1].init!.headers).has("Content-Type")).toBe(false);
  await expect(apiJson("/example", { body, json: {} })).rejects.toBeInstanceOf(ApiError);
  await expect(apiJson("/example", { json: BigInt(1) })).rejects.toMatchObject({ kind: "invalid-request" });
  expect(transport.calls).toHaveLength(2);
});

test("external URLs and escaping or malformed paths never reach fetch", async ({ transport }) => {
  for (const path of ["https://example.test", "//example.test", "health", "/../health", "/%2e%2e/health", "/a/./health", "/a\\health", "/%2fhealth", "/%252e%252e/health", "/health#fragment", "/bad%", "/health\n"]) {
    await expect(apiFetch(path)).rejects.toMatchObject({ kind: "invalid-request" });
  }
  expect(transport.calls).toHaveLength(0);
});

test("same-origin health rewrite reaches the real NestJS API", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ service: "vera-api", status: "ok", implementation: "scaffold" });
});
