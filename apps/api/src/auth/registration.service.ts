import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { PasswordService } from "./password.service";
import { RegistrationDto } from "./registration.dto";

@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}
  async register(
    input: RegistrationDto,
  ): Promise<{ created: boolean; userId?: string }> {
    const passwordHash = await this.passwords.hash(input.password);
    try {
      const existing = await this.prisma.user.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" } },
        select: { id: true },
      });
      if (existing) return { created: false };
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          declaredAdult: true,
          displayName: input.displayName,
          status: "PENDING_EMAIL",
          emailVerifiedAt: null,
          role: "MEMBER",
        },
        select: { id: true },
      });
      return { created: true, userId: user.id };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return { created: false };
      throw new ServiceUnavailableException({
        code: "REGISTRATION_UNAVAILABLE",
        message: "Registration is temporarily unavailable. Try again later.",
      });
    }
  }
}
