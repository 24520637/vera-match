import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";

export interface ExpertMfaAssurance {
  userId: string;
  sessionId: string;
  expiresAt: Date;
  testOnly: boolean;
}

/** No trusted MFA integration exists. Never consume request claims as assurance.
 * Synthetic providers are injected only in isolated tests. Production stays denied.
 */
@Injectable()
export class ExpertMfaSource {
  async resolve(_auth: AuthContext, _tx: Prisma.TransactionClient): Promise<ExpertMfaAssurance | undefined> { return undefined; }
}
