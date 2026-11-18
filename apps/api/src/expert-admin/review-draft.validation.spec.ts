import { draftPatch, requireDurationBounds } from "./review-draft.validation";

describe("T08 observation validation", () => {
  const row = { category: "EYE", startMs: 0, endMs: 1000, observation: "Turns head.", context: "During opening." };
  const patch = (value: unknown) => draftPatch({ expectedVersion: 1, observations: [value] });

  test.each([-1, 0.5, 2147483648, "100", null])("invalid start %j returns 422", startMs => {
    expect(() => patch({ ...row, startMs })).toThrow(expect.objectContaining({ status: 422 }));
  });

  test("allows the duration boundary and rejects one millisecond past it", () => {
    expect(() => requireDurationBounds([row], 1000, "observations")).not.toThrow();
    expect(() => requireDurationBounds([row], 999, "observations")).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => requireDurationBounds([row], null, "observations")).toThrow(expect.objectContaining({ status: 503 }));
  });

  test("rejects reversed ranges, absent context and injected identity", () => {
    expect(() => patch({ ...row, startMs: 1001 })).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => patch({ ...row, context: " " })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => patch({ ...row, expertId: "untrusted" })).toThrow(expect.objectContaining({ status: 400 }));
  });
});
