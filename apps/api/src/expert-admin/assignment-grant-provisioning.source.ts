import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";

export interface AssignmentGrantAdminProvisioning {
  userId: string;
  role: "ADMIN";
  active: true;
  reference: string;
  testOnly: boolean;
}

/** Trusted server integration, not User.role or a request claim. The provider must
 * verify current provisioning under the caller's User lock; provisioning revocation
 * must coordinate that same lock. No production source or provisioning flow exists.
 */
@Injectable()
export class AssignmentGrantProvisioningSource {
  async resolve(_tx: Prisma.TransactionClient, _auth: AuthContext): Promise<AssignmentGrantAdminProvisioning | undefined> {
    return undefined;
  }
}
