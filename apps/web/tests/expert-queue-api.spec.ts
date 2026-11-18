import { expect, test } from "@playwright/test";
import { createAssignment, loadExpertAssignments, loadModeratorAssignments, checkAssignmentCandidate } from "../src/lib/expert-queue-api";

test("queue adapters use implemented paths, pagination and safe response mapping", async () => {
  const original = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = async url => { calls.push(String(url)); return Response.json({ assignments: [{ id: "job", status: "ASSIGNED", dueAt: null }], nextCursor: null }); };
  try {
    expect((await loadExpertAssignments({ cursor: null, signal: new AbortController().signal })).items).toHaveLength(1);
    await loadModeratorAssignments({ cursor: "opaque_cursor", signal: new AbortController().signal });
    expect(calls).toEqual(["/api/expert/assignments/me", "/api/expert-admin/assignments?cursor=opaque_cursor"]);
  } finally { globalThis.fetch = original; }
});
test("mismatched candidate identities are rejected instead of enabling submission", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ candidate: { videoId: "other", expertId: "expert", expectedCredentialRevision: 1 } });
  try { await expect(checkAssignmentCandidate("video", "expert", new AbortController().signal)).rejects.toMatchObject({ kind: "invalid-response" }); }
  finally { globalThis.fetch = original; }
});
test("C033 adapter preserves the exact original key and payload without automatic retries", async () => {
  const original = globalThis.fetch, calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => { calls.push(init!); throw new TypeError("synthetic network failure"); };
  const body = { videoId: "video", expertId: "expert", expectedCredentialRevision: 1, dueAt: null, expiresAt: null };
  try {
    await expect(createAssignment(body, "original-key")).rejects.toMatchObject({ kind: "network" });
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].headers).get("Idempotency-Key")).toBe("original-key");
    expect(JSON.parse(calls[0].body as string)).toEqual(body);
  } finally { globalThis.fetch = original; }
});
