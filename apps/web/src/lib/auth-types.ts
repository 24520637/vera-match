export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: "MEMBER" | "EXPERT" | "MODERATOR" | "ADMIN";
}
export type AuthState =
  | {
      status: "checking" | "unauthenticated" | "unavailable" | "forbidden";
      user: null;
    }
  | { status: "authenticated"; user: AuthUser };
export function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    typeof user.email === "string" &&
    (user.displayName === null || typeof user.displayName === "string") &&
    ["MEMBER", "EXPERT", "MODERATOR", "ADMIN"].includes(String(user.role))
  );
}
