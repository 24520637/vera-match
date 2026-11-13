import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { EmailService } from "./email.service";

export const hashVerificationToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly email: EmailService,
  ) {}

  async verify(token: string) {
    const invalid = () =>
      new BadRequestException({
        code: "INVALID_VERIFICATION_LINK",
        message:
          "This activation link is invalid, expired or already used. Request a new email.",
      });
    if (Buffer.from(token, "base64url").toString("base64url") !== token)
      throw invalid();
    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.emailVerificationToken.findUnique({
          where: { tokenHash: hashVerificationToken(token) },
          select: { id: true, userId: true },
        });
        if (!row) throw invalid();
        // Same lock order as resend/login: account first, then dependent rows.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${row.userId} FOR UPDATE`;
        const now = new Date();
        const consumed = await tx.emailVerificationToken.updateMany({
          where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now },
        });
        if (consumed.count !== 1) throw invalid();
        const activated = await tx.user.updateMany({
          where: {
            id: row.userId,
            status: "PENDING_EMAIL",
            emailVerifiedAt: null,
          },
          data: { status: "ACTIVE", emailVerifiedAt: now },
        });
        if (activated.count !== 1) throw invalid();
      });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException({
        code: "VERIFICATION_UNAVAILABLE",
        message: "Activation is temporarily unavailable. Try again later.",
      });
    }
    return { message: "Email verified. You can now sign in." };
  }

  async resend(email: string) {
    let user;
    try {
      user = await this.prisma.user.findFirst({
        where: {
          email: { equals: email, mode: "insensitive" },
          status: "PENDING_EMAIL",
          emailVerifiedAt: null,
        },
        select: { id: true },
      });
    } catch {
      throw new ServiceUnavailableException({
        code: "VERIFICATION_UNAVAILABLE",
        message: "Activation is temporarily unavailable. Try again later.",
      });
    }
    if (user) await this.issue(user.id, true);
    return {
      message:
        "If this address needs activation, check its inbox. You can request another email after the cooldown.",
      retryAfterSeconds:
        this.environment.values.verification.resendCooldownSeconds,
    };
  }

  async issue(userId: string, enforceCooldown = false) {
    const token = randomBytes(32).toString("base64url");
    let delivery: { id: string; email: string } | null;
    try {
      delivery = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { email: true, status: true, emailVerifiedAt: true },
        });
        if (!user || user.status !== "PENDING_EMAIL" || user.emailVerifiedAt)
          return null;
        const now = new Date();
        if (enforceCooldown) {
          const latest = await tx.emailVerificationToken.findFirst({
            where: { userId },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          });
          if (
            latest &&
            latest.createdAt.getTime() >
              now.getTime() -
                this.environment.values.verification.resendCooldownSeconds *
                  1000
          )
            return null;
          const recent = await tx.emailVerificationToken.count({
            where: {
              userId,
              createdAt: { gt: new Date(now.getTime() - 900000) },
            },
          });
          if (recent >= 3) return null;
        }
        await tx.emailVerificationToken.updateMany({
          where: { userId, consumedAt: null },
          data: { consumedAt: now },
        });
        const row = await tx.emailVerificationToken.create({
          data: {
            userId,
            tokenHash: hashVerificationToken(token),
            expiresAt: new Date(
              now.getTime() +
                this.environment.values.verification.ttlSeconds * 1000,
            ),
          },
          select: { id: true },
        });
        return { id: row.id, email: user.email };
      });
    } catch {
      throw new ServiceUnavailableException({
        code: "VERIFICATION_UNAVAILABLE",
        message: "Activation is temporarily unavailable. Try again later.",
      });
    }
    if (!delivery) return false;
    const link = new URL("/verify-email", this.environment.values.appBaseUrl);
    // Fragment stays out of HTTP request logs and referrers; the UI POSTs only on user confirmation.
    link.hash = new URLSearchParams({ token }).toString();
    try {
      await this.email.sendVerification(delivery.email, link.toString());
    } catch (error) {
      await this.prisma.emailVerificationToken
        .updateMany({
          where: { id: delivery.id, consumedAt: null },
          data: { consumedAt: new Date() },
        })
        .catch(() => undefined);
      throw error;
    }
    return true;
  }
}
