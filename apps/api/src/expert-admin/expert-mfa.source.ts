import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { StaffMfaService } from "../staff-security/staff-mfa.service";

export interface ExpertMfaAssurance {
  userId: string;
  sessionId: string;
  expiresAt: Date;
  testOnly: boolean;
}

/** Resolve genuine session-bound TOTP proof; never consume request claims as assurance.
 * Synthetic providers are injected only in isolated tests. Production stays denied.
 */
@Injectable()
export class ExpertMfaSource {
  constructor(private readonly staffMfa?: StaffMfaService) {}

  async resolve(auth: AuthContext, tx: Prisma.TransactionClient): Promise<ExpertMfaAssurance | undefined> {
    const assurance = await this.staffMfa?.resolve(tx, auth);
    if (!assurance || assurance.level !== "MFA" || assurance.userId !== auth.user.id ||
      assurance.sessionId !== auth.sessionId || assurance.testOnly) return undefined;
    return { userId: assurance.userId, sessionId: assurance.sessionId, expiresAt: assurance.expiresAt, testOnly: false };
  }
}
