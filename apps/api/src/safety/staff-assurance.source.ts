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
/** Trusted session-bound assurance integration. No production source is configured.
 * Test overrides are local to isolated synthetic fixtures, never an env switch. */
@Injectable()
export class StaffAssuranceSource {
  async resolve(
    _tx: Prisma.TransactionClient,
    _auth: AuthContext,
  ): Promise<StaffAssurance | undefined> {
    return undefined;
  }
}
