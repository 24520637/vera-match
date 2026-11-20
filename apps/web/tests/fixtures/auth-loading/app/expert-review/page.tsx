"use client";

import { AuthProvider } from "../../../../../src/components/auth/auth-provider";
import { ExpertReviewWorkspace } from "../../../../../src/components/expert/review-workspace";

export default function ReviewFixture() {
  return <AuthProvider><ExpertReviewWorkspace assignmentId="synthetic-assignment" /></AuthProvider>;
}
