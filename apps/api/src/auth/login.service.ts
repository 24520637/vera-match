import {
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { PasswordService } from "./password.service";
import { LoginDto } from "./login.dto";
import { hashSessionToken } from "./session-token";

@Injectable()
export class LoginService implements OnModuleInit {
  private dummyHash = "";
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly environment: EnvironmentService,
  ) {}
  async onModuleInit() {
    this.dummyHash = await this.passwords.hash(
      "synthetic-unknown-account-timing-only",
    );
  }
  async login(input: LoginDto) {
    const denied = () =>
      new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message:
          "Check your email and password. Your account must be activated and available.",
      });
    try {
      const snapshot = await this.prisma.user.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" } },
        select: { id: true, passwordHash: true },
      });
      const valid = await this.passwords.verify(
        snapshot?.passwordHash ?? this.dummyHash,
        input.password,
      );
      if (!snapshot || !valid) throw denied();
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${snapshot.id} FOR UPDATE`;
        const user = await tx.user.findUnique({
          where: { id: snapshot.id },
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true,
            passwordHash: true,
            status: true,
            emailVerifiedAt: true,
          },
        });
        if (
          !user ||
          user.status !== "ACTIVE" ||
          !user.emailVerifiedAt ||
          user.passwordHash !== snapshot.passwordHash
        )
          throw denied();
        const token = randomBytes(32).toString("base64url");
        await tx.session.create({
          data: {
            userId: user.id,
            tokenHash: hashSessionToken(token),
            expiresAt: new Date(
              Date.now() + this.environment.values.session.ttlSeconds * 1000,
            ),
          },
        });
        return {
          token,
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            role: user.role,
          },
        };
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException({
        code: "LOGIN_UNAVAILABLE",
        message: "Sign-in is temporarily unavailable. Try again later.",
      });
    }
  }
}
