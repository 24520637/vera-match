"use client";

import { AuthProvider } from "../../../../../src/components/auth/auth-provider";
import { ReviewQa } from "../../../../../src/components/expert/review-qa";

export default function ReviewQaFixture() {
  return <AuthProvider><main><ReviewQa /></main></AuthProvider>;
}
