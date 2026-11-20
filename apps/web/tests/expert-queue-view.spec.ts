import { expect, test } from "@playwright/test";
import { ApiError } from "../src/lib/api";
import { queueFailure, validateQueueView } from "../src/lib/expert-queue-view";

test("view validation accepts existing assignment fields and nullable deadlines", () => {
  expect(() => validateQueueView({ items: [{ id: "synthetic", status: "ASSIGNED", dueAt: null }], nextCursor: null })).not.toThrow();
});
test("view validation rejects malformed and duplicate rows", () => {
  for (const row of [null, { id: "a", status: "UNKNOWN", dueAt: null }, { id: "a", status: "ASSIGNED", dueAt: "invalid" }])
    expect(() => validateQueueView({ items: [row], nextCursor: null } as never)).toThrow();
  const row = { id: "a", status: "ASSIGNED", dueAt: null } as const;
  expect(() => validateQueueView({ items: [row, row], nextCursor: null })).toThrow();
});
test("errors preserve recovery categories without reflecting private server text", () => {
  for (const status of [401, 403, 429, 503]) {
    const result = queueFailure(new ApiError("http", "private server detail", status));
    expect(result.message).not.toContain("private server detail");
    expect(result.title).not.toBe(queueFailure(new Error()).title);
  }
});
test("known production assurance gates explain fail-closed behavior without blaming the member role", () => {
  expect(queueFailure(new ApiError("http", "private body", 403, "ASSIGNMENT_ASSURANCE_REQUIRED"))).toEqual({
    title: "Assignment confirmation unavailable",
    message: "The server could not confirm the required staff assurance. No candidate was confirmed and no assignment was created.",
  });
  expect(queueFailure(new ApiError("http", "private body", 503, "ASSIGNMENT_ASSURANCE_UNAVAILABLE")).message)
    .toContain("No assignment was created");
  expect(queueFailure(new ApiError("http", "private body", 503, "MODERATOR_QUEUE_PROVISIONING_UNAVAILABLE")).message)
    .toContain("No assignments were loaded");
});
