import { HttpException } from "@nestjs/common";
import { assertStoredProfile, parseProfilePatch, utcAge } from "./profile.validation";

const today = new Date("2026-03-01T00:00:00Z");
describe("C020 profile contract validation", () => {
  it("normalizes NFC, outer whitespace and CRLF while preserving bio line breaks", () => {
    expect(parseProfilePatch({ expectedRevision: 0, city: "  Cafe\u0301  ", bio: " first\r\nsecond\rthird " }, today))
      .toEqual({ expectedRevision: 0, city: "Café", bio: "first\nsecond\nthird" });
  });
  it("counts Unicode code points instead of UTF-16 units", () => {
    expect(parseProfilePatch({ expectedRevision: 0, occupation: "😀".repeat(120) }, today).occupation).toHaveLength(240);
    expect(() => parseProfilePatch({ expectedRevision: 0, occupation: "😀".repeat(121) }, today)).toThrow();
    expect(() => parseProfilePatch({ expectedRevision: 0, bio: "x".repeat(2001) }, today)).toThrow();
  });
  it.each([null, [], {}, { expectedRevision: "0", city: "x" }, { expectedRevision: -1, city: "x" },
    { expectedRevision: 0 }, { expectedRevision: 0, displayName: "forbidden" },
    { expectedRevision: 0, visibilityEnabled: null }, { expectedRevision: 0, occupation: " \r\n " },
    { expectedRevision: 0, birthDate: "2000-02-30" }, { expectedRevision: 0, birthDate: "2000-01-01T00:00:00Z" },
    { expectedRevision: 0, birthDate: "2010-01-01" }, { expectedRevision: 0, relationshipGoal: "LONG-TERM" },
    { expectedRevision: 0, values: ["kindness", "kindness"] }, { expectedRevision: 0, interests: ["unsupported"] },
  ])("rejects invalid or privileged input without coercion: %j", input => {
    try { parseProfilePatch(input, today); throw new Error("Expected validation error"); }
    catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(400);
      expect((error as HttpException).getResponse()).toMatchObject({ code: "VALIDATION_FAILED", details: expect.any(Array) });
    }
  });
  it("preserves omission/null/empty collection and reports indexed errors", () => {
    expect(parseProfilePatch({ expectedRevision: 0, interests: [], values: null }, today))
      .toEqual({ expectedRevision: 0, interests: [], values: null });
    try { parseProfilePatch({ expectedRevision: 0, interests: ["reading", "reading"] }, today); }
    catch (error) {
      expect((error as HttpException).getResponse()).toMatchObject({ details: [{ field: "interests.1" }] });
    }
  });
  it("uses March 1 for February 29 in non-leap years and rejects underage dates", () => {
    const birth = new Date("2008-02-29T00:00:00Z");
    expect(utcAge(birth, new Date("2026-02-28T23:59:59Z"))).toBe(17);
    expect(utcAge(birth, today)).toBe(18);
    expect(() => parseProfilePatch({ expectedRevision: 0, birthDate: "2008-02-29" }, new Date("2026-02-28Z"))).toThrow();
    expect(parseProfilePatch({ expectedRevision: 0, birthDate: "2008-02-29" }, today).birthDate).toBe("2008-02-29");
  });
  it("returns actionable allowlisted errors without legacy payloads", () => {
    try {
      assertStoredProfile({ birthDate: null, city: null, occupation: null, bio: null,
        relationshipGoal: null, interests: { secret: "PRIVATE" }, values: null, visibilityEnabled: false }, 7, today);
      throw new Error("Expected legacy error");
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
      const body = (error as HttpException).getResponse();
      expect(body).toMatchObject({ code: "DATA_SHAPE_UNAVAILABLE", revision: 7,
        remediation: { fields: ["interests"] } });
      expect(JSON.stringify(body)).not.toMatch(/secret|PRIVATE/);
    }
  });
});
