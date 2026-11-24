import { ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AccountStatus, MemberResource, Prisma, Profile, UserRole } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { assertStoredProfile, parseProfilePatch, ProfileData, profileFields } from "./profile.validation";

const key = (userId: string) => ({ userId_resource: { userId, resource: MemberResource.PROFILE } });
const empty: ProfileData = {
  birthDate: null, occupation: null, city: null, bio: null, relationshipGoal: null,
  interests: null, values: null, visibilityEnabled: false,
};

function conflict(): never {
  throw new ConflictException({
    code: "RESOURCE_REVISION_CONFLICT", message: "This resource changed. Reload and review your edits before saving.",
    details: [{ field: "_form", messages: ["Reload before submitting again."] }],
  });
}

function project(row: Profile): ProfileData {
  return {
    birthDate: row.birthDate === null ? null :
      row.birthDate.toISOString().endsWith("T00:00:00.000Z") ? row.birthDate.toISOString().slice(0, 10) : "invalid-legacy-date",
    occupation: row.occupation, city: row.city, bio: row.bio, relationshipGoal: row.relationshipGoal,
    interests: row.interests, values: row.values, visibilityEnabled: row.visibilityEnabled,
  };
}

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService, private readonly journal?: RecoveryJournalService) {}

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
      // Never retry a mutation, expose SQL details, or treat a transport failure as success.
      throw new ServiceUnavailableException({ code: "PROFILE_STORE_UNAVAILABLE", message: "Profile storage is temporarily unavailable." });
    }
  }

  get(userId: string) {
    return this.safe(() => this.prisma.$transaction(async tx => {
      await this.authorize(tx, userId);
      const revision = Number((await tx.memberResourceRevision.findUnique({ where: key(userId) }))?.revision ?? 0n);
      const row = await tx.profile.findUnique({ where: { userId } });
      if (!row) return { revision, profile: null };
      const data = project(row);
      assertStoredProfile(data, revision);
      return { revision, profile: { ...data, updatedAt: row.updatedAt.toISOString() } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }

  patch(userId: string, input: unknown) {
    const patch = parseProfilePatch(input);
    return this.safe(() => this.prisma.$transaction(async tx => {
      // Serialize profile initialization with writes and account eligibility changes.
      // This locks only this member; no auth/session/account state is modified.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      await this.authorize(tx, userId);
      const current = Number((await tx.memberResourceRevision.findUnique({ where: key(userId) }))?.revision ?? 0n);
      if (current !== patch.expectedRevision) return conflict();
      if (current === Number.MAX_SAFE_INTEGER) {
        throw new ServiceUnavailableException({ code: "PROFILE_REVISION_EXHAUSTED", message: "Profile changes require support review." });
      }
      const existing = await tx.profile.findUnique({ where: { userId } });
      const merged = { ...(existing ? project(existing) : empty) };
      for (const field of profileFields) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) merged[field] = patch[field];
      }
      assertStoredProfile(merged, current);
      if (patch.visibilityEnabled === false) await this.journal?.record(tx, [userId], "CONSENT_WITHDRAWAL");
      await tx.memberResourceRevision.upsert({ where: key(userId),
        create: { userId, resource: MemberResource.PROFILE }, update: {},
      });
      const changed = await tx.memberResourceRevision.updateMany({
        where: { userId, resource: MemberResource.PROFILE, revision: BigInt(patch.expectedRevision) },
        data: { revision: { increment: 1n } },
      });
      if (changed.count !== 1) return conflict();
      // Write only submitted fields. In particular, never normalize omitted legacy data.
      const data: Prisma.ProfileUncheckedUpdateInput = {};
      for (const field of profileFields) {
        if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
        const value = patch[field];
        if (field === "interests" || field === "values") data[field] = value === null ? Prisma.DbNull : value as string[];
        else if (field === "birthDate") data.birthDate = value === null ? null : new Date(`${value}T00:00:00.000Z`);
        else if (field === "visibilityEnabled") data.visibilityEnabled = value as boolean;
        else data[field] = value as string | null;
      }
      const row = existing
        ? await tx.profile.update({ where: { userId }, data })
        : await tx.profile.create({ data: { userId, ...data } as Prisma.ProfileUncheckedCreateInput });
      return { revision: current + 1, profile: { ...project(row), updatedAt: row.updatedAt.toISOString() } };
    }));
  }
}
