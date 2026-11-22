import type { Prisma } from "@prisma/client";
import { profileFieldErrors, utcAge } from "../profile/profile.validation";
import { invertedRange, preferenceCatalog, preferenceFieldErrors, preferenceFields } from "../preferences/preferences.validation";

export const memberSelect = {
  id: true, role: true, status: true, emailVerifiedAt: true, declaredAdult: true,
  profile: { select: { birthDate: true, visibilityEnabled: true, relationshipGoal: true, values: true, interests: true } },
  preferences: { select: { minAge: true, maxAge: true, relationshipGoal: true, dealBreakers: true, priorities: true } },
} satisfies Prisma.UserSelect;
type Member = Prisma.UserGetPayload<{ select: typeof memberSelect }>;
type Criterion = typeof preferenceCatalog.priorities[number];

export function matchingMember(row: Member | undefined, now: Date) {
  if (!row || row.role !== "MEMBER" || row.status !== "ACTIVE" || !row.emailVerifiedAt || !row.declaredAdult ||
    !row.profile?.visibilityEnabled) return null;
  const { birthDate, relationshipGoal, values, interests } = row.profile;
  if (!birthDate || !Number.isFinite(birthDate.getTime())) return null;
  const date = birthDate.toISOString();
  if (!date.endsWith("T00:00:00.000Z") ||
    profileFieldErrors("birthDate", date.slice(0, 10), now).length) return null;
  const age = utcAge(birthDate, now);
  if (age > 120 || profileFieldErrors("relationshipGoal", relationshipGoal, now).length ||
    profileFieldErrors("values", values, now).length || profileFieldErrors("interests", interests, now).length)
    return null;

  const preferences = row.preferences ?? {
    minAge: null, maxAge: null, relationshipGoal: null, dealBreakers: null, priorities: null,
  };
  if (invertedRange(preferences) || preferenceFields.some(field =>
    preferenceFieldErrors(field, preferences[field]).length > 0)) return null;
  return {
    id: row.id, age, relationshipGoal,
    values: (values ?? []) as string[], interests: (interests ?? []) as string[],
    minAge: preferences.minAge, maxAge: preferences.maxAge, goalTarget: preferences.relationshipGoal,
    sameGoalRequired: (preferences.dealBreakers as string[] | null)?.includes("different-relationship-goal") ?? false,
    priorities: (preferences.priorities ?? preferenceCatalog.priorities) as readonly Criterion[],
  };
}

export type MatchingMember = NonNullable<ReturnType<typeof matchingMember>>;

function acceptsConstraints(viewer: MatchingMember, peer: MatchingMember) {
  return (viewer.minAge === null || peer.age >= viewer.minAge) &&
    (viewer.maxAge === null || peer.age <= viewer.maxAge) &&
    (!viewer.sameGoalRequired || (viewer.relationshipGoal !== null && viewer.relationshipGoal === peer.relationshipGoal));
}

export function reciprocalEligibility(a: MatchingMember, b: MatchingMember) {
  return a.id !== b.id && acceptsConstraints(a, b) && acceptsConstraints(b, a);
}

function jaccard(a: string[], b: string[]) {
  const union = new Set([...a, ...b]);
  return union.size ? a.filter(value => b.includes(value)).length / union.size : 0;
}

export function directionalRank(viewer: MatchingMember, peer: MatchingMember) {
  const criteria = {
    "relationship-goal": Number(viewer.goalTarget !== null && viewer.goalTarget === peer.relationshipGoal),
    values: jaccard(viewer.values, peer.values),
    interests: jaccard(viewer.interests, peer.interests),
  };
  return viewer.priorities.map(criterion => criteria[criterion]);
}

export function reciprocalRanks(a: MatchingMember, b: MatchingMember) {
  return { outgoing: directionalRank(a, b), incoming: directionalRank(b, a) };
}

export function compareRank(a: { rank: number[]; key: string }, b: { rank: number[]; key: string }) {
  for (const [index, criterion] of a.rank.entries()) {
    if (criterion !== b.rank[index]) return b.rank[index] - criterion;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
