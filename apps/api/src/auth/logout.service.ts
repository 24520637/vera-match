import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { hashSessionToken, readSessionToken } from "./session-token";
@Injectable()
export class LogoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly journal?: RecoveryJournalService,
  ) {}
  async current(cookie: unknown) {
    const token = readSessionToken(
      cookie,
      this.environment.values.session.cookieName,
    );
    if (!token) return;
    try {
      const session = await this.prisma.session.findUnique({ where: { tokenHash: hashSessionToken(token) } });
      if (!session || session.revokedAt) return;
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${session.userId} FOR UPDATE`;
        const current = await tx.session.findUnique({ where: { id: session.id } });
        if (!current || current.revokedAt) return;
        await this.journal?.record(tx, [session.userId], "SESSION_REVOCATION");
        await tx.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
      });
    } catch {
      throw this.unavailable();
    }
  }
  async all(userId: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        await this.journal?.record(tx, [userId], "SESSION_REVOCATION");
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
    } catch {
      throw this.unavailable();
    }
  }
  private unavailable() {
    return new ServiceUnavailableException({
      code: "LOGOUT_UNAVAILABLE",
      message: "Sign-out could not be confirmed. Try again.",
    });
  }
}
