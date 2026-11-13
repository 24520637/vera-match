import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EnvironmentService } from '../config/environment.service';
import { hashSessionToken, readSessionToken } from './session-token';
@Injectable()
export class LogoutService {
  constructor(private readonly prisma: PrismaService, private readonly environment: EnvironmentService) {}
  async current(cookie: unknown) {
    const token = readSessionToken(cookie, this.environment.values.session.cookieName);
    if (!token) return;
    try { await this.prisma.session.updateMany({ where: { tokenHash: hashSessionToken(token), revokedAt: null }, data: { revokedAt: new Date() } }); }
    catch { throw this.unavailable(); }
  }
  async all(userId: string) {
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      });
    } catch { throw this.unavailable(); }
  }
  private unavailable() { return new ServiceUnavailableException({ code: 'LOGOUT_UNAVAILABLE', message: 'Sign-out could not be confirmed. Try again.' }); }
}
