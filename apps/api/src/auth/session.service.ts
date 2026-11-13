import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuthContext } from './auth-context';
import { hashSessionToken } from './session-token';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(token: string): Promise<AuthContext | null> {
    let session;
    try {
      session = await this.prisma.session.findUnique({
        where: { tokenHash: hashSessionToken(token) },
        select: { id: true, expiresAt: true, revokedAt: true, user: { select: { id: true, email: true, displayName: true, role: true, status: true, emailVerifiedAt: true } } },
      });
    } catch { throw new ServiceUnavailableException({ code: 'SESSION_STORE_UNAVAILABLE', message: 'Session validation is temporarily unavailable. Try again later.' }); }
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.user.status !== AccountStatus.ACTIVE || !session.user.emailVerifiedAt) return null;
    const { id, email, displayName, role } = session.user;
    return Object.freeze({ sessionId: session.id, user: Object.freeze({ id, email, displayName, role }) });
  }
}
