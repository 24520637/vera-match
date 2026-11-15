import type { Metadata } from "next";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
export const metadata: Metadata = {
  title: "Forgot password | VERA Match",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  return (
    <AuthScaffold
      title="A fresh start."
      description="Enter the email you use for VERA Match. We will help you regain access to your account."
    >
      <ForgotPasswordForm />
    </AuthScaffold>
  );
}
