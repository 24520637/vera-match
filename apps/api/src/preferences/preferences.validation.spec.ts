import { HttpException } from "@nestjs/common";
import { invertedRange, parsePreferencesPatch, preferenceCatalog, PreferencesData, validatePreferencesState } from "./preferences.validation";

const empty: PreferencesData = { minAge: null, maxAge: null, relationshipGoal: null, dealBreakers: null, priorities: null };
function caught(run: () => unknown): HttpException {
  try { run(); } catch (error) { return error as HttpException; }
  throw new Error("Expected failure");
}
describe("C022 preferences contract validation", () => {
  it("accepts inclusive age bounds, one-sided/null ranges and no implicit defaults", () => {
    for (const [minAge, maxAge] of [[18, 120], [18, 18], [120, 120], [null, 18], [120, null], [null, null]]) {
      const patch = parsePreferencesPatch({ expectedRevision: 0, minAge, maxAge });
      expect(() => validatePreferencesState({ ...empty, ...patch }, 0, empty, patch)).not.toThrow();
    }
    expect(parsePreferencesPatch({ expectedRevision: 0, priorities: [], dealBreakers: null }))
      .toEqual({ expectedRevision: 0, priorities: [], dealBreakers: null });
  });
  it.each([null, [], {}, { expectedRevision: 0 }, { expectedRevision: "0", minAge: 18 },
    { expectedRevision: -1, minAge: 18 }, { expectedRevision: 0, minAge: 17 },
    { expectedRevision: 0, maxAge: 121 }, { expectedRevision: 0, minAge: 18.5 },
    { expectedRevision: 0, maxAge: "25" }, { expectedRevision: 0, minAge: false },
    { expectedRevision: 0, userId: "injected" }, { expectedRevision: 0, relationshipGoal: " long-term " },
    { expectedRevision: 0, priorities: "values" }, { expectedRevision: 0, dealBreakers: ["unknown"] },
    { expectedRevision: 0, priorities: ["values", "values"] },
  ])("rejects invalid DTO, aliases, duplicate IDs and coercion: %j", input => {
    expect(caught(() => parsePreferencesPatch(input)).getStatus()).toBe(400);
  });
  it("keeps exact ordering and catalogs without new weights or implicit dealbreakers", () => {
    expect(preferenceCatalog).toEqual({ goals: ["long-term", "exploring"], dealBreakers: ["different-relationship-goal"],
      priorities: ["relationship-goal", "values", "interests"] });
    const patch = parsePreferencesPatch({ expectedRevision: 0, priorities: ["interests", "values", "relationship-goal"], relationshipGoal: "long-term" });
    expect(patch.priorities).toEqual(["interests", "values", "relationship-goal"]);
    expect(patch).not.toHaveProperty("dealBreakers");
    const error = caught(() => parsePreferencesPatch({ expectedRevision: 0, priorities: ["values", "unknown"] }));
    expect(error.getResponse()).toMatchObject({ details: [{ field: "priorities.1" }] });
  });
  it("validates merged ranges with visible maxAge errors", () => {
    const original = { ...empty, minAge: 20, maxAge: 30 };
    const patch = parsePreferencesPatch({ expectedRevision: 2, minAge: 35 });
    expect(invertedRange({ ...original, ...patch })).toBe(true);
    const error = caught(() => validatePreferencesState({ ...original, ...patch }, 2, original, patch));
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ details: [{ field: "maxAge" }] });
    expect(() => validatePreferencesState({ ...original, minAge: null }, 2)).not.toThrow();
  });
  it("rejects remaining legacy corruption and malformed ranges without leaking stored values", () => {
    const broken = { ...empty, priorities: { private_key: "PRIVATE" } };
    const error = caught(() => validatePreferencesState(broken, 8));
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({ code: "DATA_SHAPE_UNAVAILABLE", resource: "preferences", revision: 8,
      remediation: { fields: ["priorities"] } });
    expect(JSON.stringify(error.getResponse())).not.toMatch(/private_key|PRIVATE/);
    const inverted = { ...empty, minAge: 90, maxAge: 20 };
    expect(caught(() => validatePreferencesState(inverted, 8)).getStatus()).toBe(503);
    expect(caught(() => validatePreferencesState({ ...inverted, minAge: 80 }, 8, inverted,
      { expectedRevision: 8, minAge: 80 })).getStatus()).toBe(503);
    expect(() => validatePreferencesState({ ...inverted, minAge: null }, 8, inverted,
      { expectedRevision: 8, minAge: null })).not.toThrow();
  });
});
