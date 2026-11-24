import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { PrismaService } from "../database/prisma.service";
import { PasswordService } from "./password.service";
import { hashResetToken } from "./password-recovery.service";
import { ResetPasswordDto } from "./reset-password.dto";

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly journal?: RecoveryJournalService,
  ) {}
  async reset(input: ResetPasswordDto) {
    const invalid = () =>
      new BadRequestException({
        code: "INVALID_RESET_LINK",
        message:
          "This reset link is invalid, expired or already used. Request a new link.",
      });
    if (
      Buffer.from(input.token, "base64url").toString("base64url") !==
      input.token
    )
      throw invalid();
    try {
      const row = await this.prisma.passwordResetToken.findUnique({
        where: { tokenHash: hashResetToken(input.token) },
      });
      if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now())
        throw invalid();
      // Hash outside the lock; eligibility and single-use consumption are checked again in the transaction.
      const passwordHash = await this.passwords.hash(input.newPassword);
      await this.prisma.$transaction(async (tx) => {
        // Account first: the same lock order as login, logout-all and token issuance.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${row.userId} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: row.userId } });
        if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt)
          throw invalid();
        const now = new Date();
        const consumed = await tx.passwordResetToken.updateMany({
          where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now },
        });
        if (consumed.count !== 1) throw invalid();
        await this.journal?.record(tx, [user.id], "PASSWORD_RESET");
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash },
        });
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, consumedAt: null },
          data: { consumedAt: now },
        });
        await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "PASSWORD_RESET_COMPLETED",
            subjectType: "User",
            subjectId: user.id,
          },
        });
      });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException({
        code: "RESET_UNAVAILABLE",
        message: "Password reset is temporarily unavailable. Try again later.",
      });
    }
    // No automatic login, activation or blind clearing of a cookie belonging to another account.
    return {
      message:
        "Password updated. All existing sessions for this account have ended. Sign in with your new password.",
    };
  }
}
