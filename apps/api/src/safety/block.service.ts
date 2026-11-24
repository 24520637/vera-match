import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { AuthContext } from "../auth/auth-context";
import { SafetyAccessService } from "./safety-access.service";
import {
  blockInput,
  cursor,
  emptyInput,
  identifier,
  nextCursor,
  object,
} from "./safety.validation";
@Injectable()
export class BlockService {
  constructor(private readonly access: SafetyAccessService, private readonly journal?: RecoveryJournalService) {}
  block(auth: AuthContext, input: unknown) {
    const target = blockInput(input);
    if (target === auth.user.id)
      throw new BadRequestException({
        code: "SELF_BLOCK",
        message: "You cannot block your own account.",
      });
    return this.access.run(auth, "MEMBER", [target], async (tx) => {
      const peer = await tx.user.findUnique({
        where: { id: target },
        select: { status: true, emailVerifiedAt: true },
      });
      if (!peer || peer.status !== "ACTIVE" || !peer.emailVerifiedAt)
        throw new NotFoundException({
          code: "MEMBER_UNAVAILABLE",
          message: "This account reference is unavailable.",
        });
      const existing = await tx.block.findUnique({
        where: {
          blockerId_blockedId: { blockerId: auth.user.id, blockedId: target },
        },
        select: { id: true },
      });
      if (!existing) {
        await this.journal?.record(tx, [auth.user.id, target], "BLOCK");
        const row = await tx.block.create({
          data: { blockerId: auth.user.id, blockedId: target },
        });
        await tx.auditLog.create({
          data: {
            actorId: auth.user.id,
            action: "SAFETY_BLOCK_CREATED",
            subjectType: "Block",
            subjectId: row.id,
          },
        });
      }
      await tx.matchPair.updateMany({ where: {
        connectionRevokedAt: null,
        OR: [
          { userLowId: auth.user.id, userHighId: target },
          { userLowId: target, userHighId: auth.user.id },
        ],
      }, data: { connectionRevokedAt: new Date() } });
    });
  }
  unblock(auth: AuthContext, value: unknown, input: unknown) {
    const target = identifier(value, "targetUserId");
    emptyInput(input);
    return this.access.run(auth, "MEMBER", [target], async (tx) => {
      const row = await tx.block.findUnique({
        where: {
          blockerId_blockedId: { blockerId: auth.user.id, blockedId: target },
        },
        select: { id: true },
      });
      if (row) {
        await tx.block.delete({ where: { id: row.id } });
        await tx.auditLog.create({
          data: {
            actorId: auth.user.id,
            action: "SAFETY_BLOCK_REMOVED",
            subjectType: "Block",
            subjectId: row.id,
          },
        });
      }
    });
  }
  list(auth: AuthContext, query: unknown) {
    const q = object(query, ["cursor"]),
      after = cursor(q.cursor);
    return this.access.run(auth, "MEMBER", [], async (tx) => {
      const rows = await tx.block.findMany({
        where: {
          blockerId: auth.user.id,
          ...(after ? { id: { lt: after } } : {}),
        },
        orderBy: { id: "desc" },
        take: 51,
        select: { id: true, blockedId: true, createdAt: true },
      });
      return {
        blocks: rows
          .slice(0, 50)
          .map((r) => ({ targetUserId: r.blockedId, createdAt: r.createdAt })),
        nextCursor: rows.length > 50 ? nextCursor(rows[49].id) : null,
      };
    });
  }
}
