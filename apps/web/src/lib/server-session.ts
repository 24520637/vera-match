import "server-only";
import { cookies } from "next/headers";
import { isAuthUser } from "./auth-types";

export async function getServerSession() {
  try {
    const origin = new URL(
      process.env.API_INTERNAL_ORIGIN || "http://localhost:4000",
    );
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      return { status: "unavailable" } as const;
    const base = origin.origin + "/api";
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
