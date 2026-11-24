import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { Prisma, type StaffIdentity } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { StaffAuthority } from "./staff-authority";
import { staffEmailDigest, type StaffDirective } from "./staff-directive";

const denied = (): never => { throw new ForbiddenException({code:"STAFF_IDENTITY_REQUIRED",message:"Current trusted staff identity is required."}); };
const conflict = (): never => { throw new ConflictException({code:"STAFF_DIRECTIVE_CONFLICT",message:"Use an explicit directive for the current identity revision."}); };
export async function staffDatabaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  return row.now;
}
@Injectable()
export class StaffIdentityService {
  constructor(private readonly prisma: PrismaService, private readonly authority: StaffAuthority,
    private readonly journal?: RecoveryJournalService) {}
  /** Called by an operator tool, never by a browser role/self-provisioning endpoint. */
  async apply(serialized: string) {
    const candidate = this.authority.verify(serialized,new Date());
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${candidate.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({where:{id:candidate.userId}});
      if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt || staffEmailDigest(user.email) !== candidate.emailDigest) return denied();
      await tx.$queryRaw`SELECT id FROM "Session" WHERE "userId"=${user.id} ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT "userId" FROM "StaffIdentity" WHERE "userId"=${user.id} FOR UPDATE`;
      const now = await staffDatabaseNow(tx), payload = this.authority.verify(serialized,now);
      const current = await tx.staffIdentity.findUnique({where:{userId:user.id},include:{currentDirective:true}});
      if (current?.currentDirectiveId === payload.directiveId) {
        if (current.currentDirective.signedDirective !== serialized) return conflict();
        return {directiveId:payload.directiveId,revision:Number(current.revision),replayed:true};
      }
      if ((!current && (payload.revision !== 1 || payload.mfaEpoch !== 1)) || (current && (payload.subjectId !== current.subjectId || BigInt(payload.revision) !== current.revision+1n || BigInt(payload.mfaEpoch) < current.mfaEpoch || BigInt(payload.mfaEpoch) > current.mfaEpoch+1n))) return conflict();
      const prior = current && payload.state === "ACTIVE" ? this.authority.verify(current.currentDirective.signedDirective, new Date(Math.min(now.getTime(), current.expiresAt.getTime()-1))) : undefined;
      if (current && payload.state === "ACTIVE" && prior && ((BigInt(payload.mfaEpoch) === current.mfaEpoch && payload.enrollmentKeyHash !== prior.enrollmentKeyHash) || (BigInt(payload.mfaEpoch) > current.mfaEpoch && payload.enrollmentKeyHash === prior.enrollmentKeyHash))) return conflict();
      // Reactivation and role changes require an explicit new enrollment epoch.
      if (current && payload.state === "ACTIVE" && (current.state === "REVOKED" || current.role !== payload.role) && BigInt(payload.mfaEpoch) !== current.mfaEpoch+1n) return conflict();
      await this.journal?.record(tx, [user.id], "STAFF_RESTRICTION");
      await tx.staffTrustEvent.create({data:{directiveId:payload.directiveId,userId:user.id,subjectId:payload.subjectId,revision:BigInt(payload.revision),mfaEpoch:BigInt(payload.mfaEpoch),signedDirective:serialized}});
      const data = {subjectId:payload.subjectId,revision:BigInt(payload.revision),mfaEpoch:BigInt(payload.mfaEpoch),role:payload.role,state:payload.state,expiresAt:new Date(payload.expiresAt),currentDirectiveId:payload.directiveId};
      if (current) {
        const changed = await tx.staffIdentity.updateMany({where:{userId:user.id,revision:current.revision},data});
        if (changed.count !== 1) return conflict();
      } else await tx.staffIdentity.create({data:{userId:user.id,...data}});
      if (payload.state === "ACTIVE") await tx.user.update({where:{id:user.id},data:{role:payload.role}});
      await tx.session.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:now}});
      await tx.auditLog.create({data:{actorId:null,action:payload.state === "ACTIVE"?"STAFF_AUTHORITY_PROVISIONED":"STAFF_AUTHORITY_REVOKED",subjectType:"StaffIdentity",subjectId:payload.subjectId}});
      return {directiveId:payload.directiveId,revision:payload.revision,replayed:false};
    });
  }
  /** Consumers already hold User -> Session locks; no browser role assertion suffices. */
  async current(tx: Prisma.TransactionClient, userId: string, now: Date,
    permission?: StaffDirective["permissions"][number]): Promise<StaffIdentity | undefined> {
    const identity = await tx.staffIdentity.findUnique({where:{userId},include:{currentDirective:true,user:{select:{email:true,role:true,status:true,emailVerifiedAt:true}}}});
    if (!identity || identity.state !== "ACTIVE" || identity.expiresAt <= now || identity.user.status !== "ACTIVE" || !identity.user.emailVerifiedAt) return undefined;
    try {
      const p = this.authority.verify(identity.currentDirective.signedDirective,now);
      if (p.userId !== userId || p.subjectId !== identity.subjectId || p.directiveId !== identity.currentDirectiveId || BigInt(p.revision) !== identity.revision || BigInt(p.mfaEpoch) !== identity.mfaEpoch || p.state !== "ACTIVE" || p.role !== identity.role || p.role !== identity.user.role || p.expiresAt !== identity.expiresAt.toISOString() || p.emailDigest !== staffEmailDigest(identity.user.email)) return undefined;
      if (permission && !p.permissions.includes(permission)) return undefined;
      return identity;
    } catch { return undefined; }
  }
}
