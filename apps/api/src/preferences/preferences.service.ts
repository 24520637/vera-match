import { ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AccountStatus, MatchPreference, MemberResource, Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { parsePreferencesPatch, preferenceFields, PreferencesData, validatePreferencesState } from "./preferences.validation";

const key = (userId: string) => ({ userId_resource: { userId, resource: MemberResource.PREFERENCES } });
const empty: PreferencesData = { minAge: null, maxAge: null, relationshipGoal: null, dealBreakers: null, priorities: null };
const project = (row: MatchPreference): PreferencesData => ({ minAge: row.minAge, maxAge: row.maxAge,
  relationshipGoal: row.relationshipGoal, dealBreakers: row.dealBreakers, priorities: row.priorities });
function conflict(): never {
  throw new ConflictException({ code: "RESOURCE_REVISION_CONFLICT", message: "This resource changed. Reload and review your edits before saving.",
    details: [{ field: "_form", messages: ["Reload before submitting again."] }] });
}

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}
  private async authorize(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true, role: true, emailVerifiedAt: true } });
    if (!user || user.status !== AccountStatus.ACTIVE || user.role !== UserRole.MEMBER || !user.emailVerifiedAt) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "An active verified member is required." });
    }
  }
  private async safe<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: "PREFERENCES_STORE_UNAVAILABLE", message: "Preferences storage is temporarily unavailable." });
    }
  }
  get(userId: string) {
    return this.safe(() => this.prisma.$transaction(async tx => {
      await this.authorize(tx, userId);
      const revision = Number((await tx.memberResourceRevision.findUnique({ where: key(userId) }))?.revision ?? 0n);
      const row = await tx.matchPreference.findUnique({ where: { userId } });
      if (!row) return { revision, preferences: null };
      const data = project(row);
      validatePreferencesState(data, revision);
      return { revision, preferences: { ...data, updatedAt: row.updatedAt.toISOString() } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }
  patch(userId: string, input: unknown) {
    const patch = parsePreferencesPatch(input);
    return this.safe(() => this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      await this.authorize(tx, userId);
      const current = Number((await tx.memberResourceRevision.findUnique({ where: key(userId) }))?.revision ?? 0n);
      if (current !== patch.expectedRevision) return conflict();
      if (current === Number.MAX_SAFE_INTEGER) throw new ServiceUnavailableException({
        code: "PREFERENCES_REVISION_EXHAUSTED", message: "Preferences changes require support review.",
      });
      const existing = await tx.matchPreference.findUnique({ where: { userId } });
      const original = existing ? project(existing) : empty;
      const merged = { ...original };
      for (const field of preferenceFields) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) merged[field] = patch[field];
      }
      validatePreferencesState(merged, current, original, patch);
      await tx.memberResourceRevision.upsert({ where: key(userId), create: { userId, resource: MemberResource.PREFERENCES }, update: {} });
      const changed = await tx.memberResourceRevision.updateMany({
        where: { userId, resource: MemberResource.PREFERENCES, revision: BigInt(patch.expectedRevision) },
        data: { revision: { increment: 1n } },
      });
      if (changed.count !== 1) return conflict();
      const data: Prisma.MatchPreferenceUncheckedUpdateInput = {};
      for (const field of preferenceFields) {
        if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
        if (field === "dealBreakers" || field === "priorities") data[field] = patch[field] === null ? Prisma.DbNull : patch[field];
        else if (field === "relationshipGoal") data[field] = patch[field];
        else data[field] = patch[field];
      }
      const row = existing ? await tx.matchPreference.update({ where: { userId }, data })
        : await tx.matchPreference.create({ data: { userId, ...data } as Prisma.MatchPreferenceUncheckedCreateInput });
      return { revision: current + 1, preferences: { ...project(row), updatedAt: row.updatedAt.toISOString() } };
    }));
  }
}
