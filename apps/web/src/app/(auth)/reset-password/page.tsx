import type { Metadata } from "next";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
export const metadata: Metadata = {
  title: "Reset password | VERA Match",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  return (
    <AuthScaffold
      title="Choose a new password."
      description="Keep your account yours. Choose a long, unique password that you do not use elsewhere."
    >
      <ResetPasswordForm />
    </AuthScaffold>
  );
}
