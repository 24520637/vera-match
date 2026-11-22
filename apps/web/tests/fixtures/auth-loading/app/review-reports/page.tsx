"use client";

import { AuthProvider } from "../../../../../src/components/auth/auth-provider";
import { MemberReviewReports } from "../../../../../src/components/member/review-reports";

export default function ReviewReportsFixture() {
  return <AuthProvider><MemberReviewReports /></AuthProvider>;
}
