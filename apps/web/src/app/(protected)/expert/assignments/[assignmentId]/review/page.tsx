import type { Metadata } from "next";
import { ExpertReviewWorkspace } from "@/components/expert/review-workspace";

export const metadata: Metadata = { title: "Expert review workspace", referrer: "no-referrer" };

export default async function ReviewPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  return <ExpertReviewWorkspace assignmentId={assignmentId} />;
}
