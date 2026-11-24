import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { StaffIdentityService, staffDatabaseNow } from "../staff-security/staff-identity.service";

export interface AssignmentGrantAdminProvisioning {
  userId: string;
  role: "ADMIN";
  active: true;
  reference: string;
  testOnly: boolean;
}

/** The caller holds the same User lock used to apply or revoke signed directives. */
@Injectable()
export class AssignmentGrantProvisioningSource {
  constructor(readonly identities?: StaffIdentityService) {}

  async resolve(tx: Prisma.TransactionClient, auth: AuthContext): Promise<AssignmentGrantAdminProvisioning | undefined> {
    if (!this.identities || auth.user.role !== "ADMIN") return undefined;
    const identity = await this.identities.current(tx, auth.user.id, await staffDatabaseNow(tx), "ASSIGNMENT_GRANT_ADMIN");
    if (identity?.role !== "ADMIN") return undefined;
    return { userId: identity.userId, role: "ADMIN", active: true, reference: identity.currentDirectiveId, testOnly: false };
  }
}
