import {
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { AuthContext } from "../auth/auth-context";
import { PrismaService } from "../database/prisma.service";
export async function lockSafetyUsers(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join([...new Set(ids)].sort())}) ORDER BY id FOR UPDATE`,
  );
}
@Injectable()
export class SafetyAccessService {
  constructor(private readonly prisma: PrismaService) {}
  async run<T>(
    auth: AuthContext,
    role: UserRole,
    peers: string[],
    action: (tx: Prisma.TransactionClient, now: Date) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockSafetyUsers(tx, [auth.user.id, ...peers]);
        const user = await tx.user.findUnique({
          where: { id: auth.user.id },
          select: { role: true, status: true, emailVerifiedAt: true },
        });
        if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt)
          throw new UnauthorizedException({
            code: "UNAUTHENTICATED",
            message: "A valid session is required.",
          });
        if (user.role !== role)
          throw new ForbiddenException({
            code: "FORBIDDEN",
            message: "This operation is not available for your role.",
          });
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${auth.sessionId} FOR SHARE`;
        const session = await tx.session.findUnique({
          where: { id: auth.sessionId },
          select: { userId: true, revokedAt: true, expiresAt: true },
        });
        const [clock] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
        if (
          !session ||
          session.userId !== auth.user.id ||
          session.revokedAt ||
          session.expiresAt <= clock.now
        )
          throw new UnauthorizedException({
            code: "UNAUTHENTICATED",
            message: "A valid session is required.",
          });
        return action(tx, clock.now);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        code: "SAFETY_STORE_UNAVAILABLE",
        message:
          "Safety changes could not be confirmed. Refresh before retrying.",
      });
    }
  }
}
