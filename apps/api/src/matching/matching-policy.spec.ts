import { describe, expect, it } from "@jest/globals";
import { compareRank, matchingMember, reciprocalEligibility, reciprocalRanks } from "./matching-policy";

const now = new Date("2026-03-01T00:00:00Z");
const row = (id: string, birthDate = "1996-02-29T00:00:00Z") => ({
  id, role: "MEMBER" as const, status: "ACTIVE" as const, emailVerifiedAt: now, declaredAdult: true,
  profile: { birthDate: new Date(birthDate), visibilityEnabled: true, relationshipGoal: "long-term" as string | null,
    values: ["family", "honesty"], interests: ["reading", "music"] },
  preferences: { minAge: null as number | null, maxAge: null as number | null,
    relationshipGoal: "exploring", dealBreakers: [] as string[], priorities: null as string[] | null },
});

describe("T14 matching policy and directional ranks", () => {
  it("checks exact UTC boundaries, leap birthdays, and malformed legacy values", () => {
    expect(matchingMember(row("a"), new Date("2026-02-28T23:59:59Z"))?.age).toBe(29);
    expect(matchingMember(row("a"), now)?.age).toBe(30);
    expect(matchingMember(row("a", "2008-03-01"), now)?.age).toBe(18);
    expect(matchingMember(row("a", "1906-03-01"), now)?.age).toBe(120);
    for (const invalid of ["1905-03-01", "2008-03-02", "2027-01-01", "invalid", "1996-02-29T00:00:01Z"])
      expect(matchingMember(row("a", invalid), now)).toBeNull();
    const legacy = row("a");
    legacy.preferences.minAge = 45;
    legacy.preferences.maxAge = 40;
    expect(matchingMember(legacy, now)).toBeNull();
    expect(matchingMember({ ...row("a"), declaredAdult: false }, now)).toBeNull();
    expect(matchingMember({ ...row("a"), profile: { ...row("a").profile, visibilityEnabled: false } }, now)).toBeNull();
    expect(matchingMember({ ...row("a"), status: "SUSPENDED" }, now)).toBeNull();
  });

  it("enforces both directions and only treats an explicit goal dealbreaker as hard", () => {
    const a = matchingMember(row("a"), now)!;
    const b = matchingMember(row("b", "1991-03-01"), now)!;
    expect(reciprocalEligibility(a, a)).toBe(false);
    expect(reciprocalEligibility({ ...a, minAge: 35, maxAge: 35 }, { ...b, maxAge: 30 })).toBe(true);
    expect(reciprocalEligibility(a, { ...b, minAge: 31 })).toBe(false);
    expect(reciprocalEligibility({ ...a, maxAge: 34 }, b)).toBe(false);
    expect(reciprocalEligibility(a, { ...b, relationshipGoal: "exploring" })).toBe(true);
    expect(reciprocalEligibility(a, { ...b, relationshipGoal: "exploring", sameGoalRequired: true })).toBe(false);
    expect(reciprocalEligibility({ ...a, sameGoalRequired: true }, { ...b, relationshipGoal: null })).toBe(false);
  });

  it("uses the configured direction, Jaccard and lexicographic priority before the opaque tie key", () => {
    const a = matchingMember(row("a"), now)!;
    const other = row("b");
    other.profile.relationshipGoal = "exploring";
    other.profile.values = ["family", "communication"];
    other.profile.interests = ["reading"];
    other.preferences.priorities = ["interests", "relationship-goal"];
    const b = matchingMember(other, now)!;
    expect(reciprocalRanks(a, b)).toEqual({ outgoing: [1, 1 / 3, 1 / 2], incoming: [1 / 2, 0] });
    expect(reciprocalRanks({ ...a, priorities: [] }, b).outgoing).toEqual([]);
    expect(compareRank({ rank: [1, 0], key: "z" }, { rank: [0, 1], key: "a" })).toBeLessThan(0);
    expect(compareRank({ rank: [], key: "z" }, { rank: [], key: "a" })).toBeGreaterThan(0);
  });
});
