import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { EmailService } from "./email.service";

export const hashResetToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Bounded, non-durable MVP worker. HTTP acceptance never waits for account lookup or SMTP. */
@Injectable()
export class PasswordRecoveryService implements OnModuleDestroy {
  private readonly logger = new Logger(PasswordRecoveryService.name);
  private readonly pending: string[] = [];
  private worker?: Promise<void>;
  private stopping = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly email: EmailService,
  ) {}

  request(address: string) {
    if (this.stopping || this.pending.length >= 32)
      throw new ServiceUnavailableException({
        code: "RECOVERY_BUSY",
        message: "Please try again shortly.",
      });
    this.pending.push(address);
    if (!this.worker)
      this.worker = new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => this.drain())
        .finally(() => {
          this.worker = undefined;
        });
    return {
      message:
        "Request received. If this address is eligible, check your inbox for a password reset link.",
      retryAfterSeconds: this.environment.values.recovery.resendCooldownSeconds,
    };
  }

  private async drain() {
    while (this.pending.length) {
      const address = this.pending.shift()!;
      try {
        await this.issue(address);
      } catch {
        this.logger.warn(
          "A password recovery delivery could not be completed. No request details recorded.",
        );
      }
    }
  }

  private async issue(address: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: address },
      select: { id: true },
    });
    if (!user) return;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashResetToken(token);
    const config = this.environment.values.recovery;
    const issued = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      const account = await tx.user.findUnique({ where: { id: user.id } });
      if (!account || account.status !== "ACTIVE" || !account.emailVerifiedAt)
        return false;
      const now = new Date();
      const latest = await tx.passwordResetToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      if (
        latest &&
        now.getTime() - latest.createdAt.getTime() <
          config.resendCooldownSeconds * 1000
      )
        return false;
      if (
        (await tx.passwordResetToken.count({
          where: {
            userId: user.id,
            createdAt: { gt: new Date(now.getTime() - 900000) },
          },
        })) >= 3
      )
        return false;
      // Keep the previous delivered link usable while SMTP is in flight.
      const row = await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          createdAt: now,
          tokenHash,
          expiresAt: new Date(now.getTime() + config.ttlSeconds * 1000),
        },
      });
      return { id: row.id, createdAt: row.createdAt, email: account.email };
    });
    if (!issued) return;
    const link = new URL("/reset-password", this.environment.values.appBaseUrl);
    link.hash = new URLSearchParams({ token }).toString();
    try {
      await this.email.sendPasswordReset(issued.email, link.toString());
    } catch (error) {
      await this.prisma.passwordResetToken.updateMany({
        where: { tokenHash, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      throw error;
    }
    // SMTP accepted the email. A failed or ambiguous DB confirmation must not
    // revoke its token; the existing reset transaction can safely consume all links.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      const account = await tx.user.findUnique({ where: { id: user.id } });
      const now = new Date();
      if (
        !account ||
        account.status !== "ACTIVE" ||
        !account.emailVerifiedAt ||
        account.email !== issued.email
      ) {
        await tx.passwordResetToken.updateMany({
          where: { id: issued.id, consumedAt: null },
          data: { consumedAt: now },
        });
        return;
      }
      const current = await tx.passwordResetToken.findFirst({
        where: { id: issued.id, consumedAt: null, expiresAt: { gt: now } },
      });
      // Reset or a newer confirmed delivery may already have consumed this row.
      // Never reactivate it or invalidate a newer link after a delayed SMTP acknowledgement.
      if (!current) return;
      await tx.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          consumedAt: null,
          createdAt: { lt: issued.createdAt },
        },
        data: { consumedAt: now },
      });
    });
  }

  async onModuleDestroy() {
    this.stopping = true;
    await this.worker;
  }
}
