import { expect, test } from "@playwright/test";
import { ApiError, apiJson } from "../src/lib/api";
import { defaults, memberErrors, readConsents, readResource, resourcePayload, questions, purposes, readPublishedPolicies } from "../src/lib/member-contracts";

test("PATCH sends only explicit dirty fields, preserving null, [] and omission", () => {
  expect(resourcePayload("profile", 4, { ...defaults("profile"), city: null, interests: [] }, ["city", "interests"]))
    .toEqual({ expectedRevision: 4, city: null, interests: [] });
  expect(resourcePayload("preferences", 7, { ...defaults("preferences"), priorities: ["interests", "values"] }, ["priorities"]))
    .toEqual({ expectedRevision: 7, priorities: ["interests", "values"] });
});
test("questionnaire submits three canonical answers and independent editing revision", () => {
  const values = Object.fromEntries(questions.map((q, i) => [`answers.${i}.responseText`, q.key]));
  expect(resourcePayload("questionnaire", 12, values, ["answers.0.responseText"]))
    .toEqual({ expectedRevision: 12, questionnaireVersion: 1, answers: questions.map(q => ({ questionKey: q.key, responseText: q.key })) });
});
test("runtime response checks do not turn unavailable data into OFF or empty success", () => {
  expect(() => readConsents({ version: 0, consents: [] })).toThrow();
  expect(() => readResource("profile", { revision: "0", profile: null })).toThrow();
  expect(readResource("preferences", { revision: 0, preferences: null })).toMatchObject({ revision: 0, empty: true });
  expect(readConsents({ version: 0, consents: purposes.map(purpose => ({ purpose, granted: false,
    grantedAt: null, revokedAt: null, updatedAt: null, policyVersion: null })) }).version).toBe(0);
});
test("known nested paths map to visible fields and unknown paths fall back to the summary", () => {
  const error = new ApiError("http", "Check fields", 400, "VALIDATION_FAILED", [
    { field: "interests.0", messages: ["Unsupported interest"] },
    { field: "unknown.path", messages: ["Review the form"] },
  ]);
  expect(memberErrors(error, ["interests"])).toEqual({ interests: "Unsupported interest", _form: "Review the form" });
});
test("the existing transport preserves only safe legacy revision metadata", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ code: "DATA_SHAPE_UNAVAILABLE", revision: 9,
      details: [{ field: "interests", messages: ["Replace explicitly"] }], private: "not exposed" }, { status: 503 });
    await expect(apiJson("/profile/me")).rejects.toMatchObject({ status: 503, resourceRevision: 9 });
    globalThis.fetch = async () => Response.json({ code: "DATA_SHAPE_UNAVAILABLE", revision: "9" }, { status: 503 });
    await expect(apiJson("/profile/me")).rejects.toMatchObject({ resourceRevision: undefined });
  } finally { globalThis.fetch = original; }
});

test("published policy parsing binds exact displayed UTF-8 content, locale and digest", async () => {
  const { createHash } = await import("node:crypto");
  const content = "Synthetic notice — thử nghiệm";
  const entry = { purpose: "VIDEO_STORAGE", policyVersion: "2026.v1", locale: "vi", content, digest: createHash("sha256").update(content).digest("hex"), optional: true, dependencies: [] };
  expect((await readPublishedPolicies({ locale: "vi", policies: [entry] }, "vi")).VIDEO_STORAGE).toMatchObject({ content, digest: entry.digest, locale: "vi" });
  await expect(readPublishedPolicies({ locale: "vi", policies: [{ ...entry, content: content + " altered" }] }, "vi")).rejects.toThrow();
  await expect(readPublishedPolicies({ locale: "en", policies: [entry] }, "en")).rejects.toThrow();
  await expect(readPublishedPolicies({ locale: "vi", policies: [entry, entry] }, "vi")).rejects.toThrow();
  await expect(readPublishedPolicies({ locale: "vi", policies: [{ ...entry, dependencies: ["UNSUPPORTED"] }] }, "vi")).rejects.toThrow();
  expect(await readPublishedPolicies({ locale: "vi", policies: [] }, "vi")).toEqual({});
});
