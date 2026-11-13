import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { safeNextPath } from "@/lib/auth-redirect";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { LoginForm } from "@/components/auth/login-form";
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const nextPath = safeNextPath((await searchParams).next);
  if ((await getServerSession()).status === "authenticated") redirect(nextPath);
  return (
    <AuthScaffold
      title="Welcome back."
      description="Sign in to your account. Pick up where you left off, at your own pace."
    >
      <LoginForm nextPath={nextPath} />
    </AuthScaffold>
  );
}
