import type { Request } from "express";
import type { UserRole } from "@prisma/client";

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: UserRole;
}
export interface AuthContext {
  readonly sessionId: string;
  readonly user: CurrentUser;
}
export type AuthenticatedRequest = Request & { auth?: AuthContext };
