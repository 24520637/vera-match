import type { StaffMfaService } from "../staff-security/staff-mfa.service";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthContext } from "../auth/auth-context";
export interface StaffAssurance {
  userId: string;
  sessionId: string;
  level: "MFA";
  verifiedAt: Date;
  expiresAt: Date;
  testOnly: boolean;
}
/** Trusted session-bound TOTP assurance integration. Missing authority, keys or proof denies.
 * Test overrides are local to isolated synthetic fixtures, never an env switch. */
@Injectable()
export class StaffAssuranceSource {
  constructor(readonly mfa?: StaffMfaService) {}
  async resolve(
    _tx: Prisma.TransactionClient,
    _auth: AuthContext,
  ): Promise<StaffAssurance | undefined> {
    return this.mfa?.resolve(_tx, _auth);
  }
}
