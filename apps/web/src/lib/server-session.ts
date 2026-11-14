import "server-only";
import { cookies } from "next/headers";
import { isAuthUser } from "./auth-types";

export async function getServerSession() {
  const configured =
    process.env.API_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  const base = configured?.startsWith("http")
    ? configured
    : "http://localhost:4000/api";
  try {
    const response = await fetch(`${base}/auth/me`, {
      headers: { Cookie: (await cookies()).toString() },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) return { status: "unauthenticated" } as const;
    if (response.status === 403) return { status: "forbidden" } as const;
    if (!response.ok) return { status: "unavailable" } as const;
    const user: unknown = await response.json();
    return isAuthUser(user)
      ? ({ status: "authenticated", user } as const)
      : ({ status: "unavailable" } as const);
  } catch {
    return { status: "unavailable" } as const;
  }
}
