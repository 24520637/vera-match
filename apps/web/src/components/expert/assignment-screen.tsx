"use client";
import { useAuth } from "../auth/auth-provider";
import { AssignmentQueue, type AssignmentQueueRole } from "./assignment-queue";
import { AssignmentComposer } from "./assignment-composer";
import { loadExpertAssignments, loadModeratorAssignments } from "@/lib/expert-queue-api";

export function AssignmentScreen({ role }: { role: AssignmentQueueRole }) {
  const { state } = useAuth();
  return <>
    <AssignmentQueue role={role} loader={role === "EXPERT" ? loadExpertAssignments : loadModeratorAssignments} />
    {role === "MODERATOR" && state.status === "authenticated" && state.user.role === "MODERATOR" &&
      <AssignmentComposer key={state.user.id} ownerId={state.user.id} />}
  </>;
}
