import { ApiError } from "./api";

export const assignmentStatusLabels = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
} as const;

/** Presentation model using existing assignment fields, NOT a proposed wire DTO.
 * Status filters, sort, visibility and the live pagination contract await approval.
 */
export interface AssignmentQueueRow {
  id: string;
  status: keyof typeof assignmentStatusLabels;
  dueAt: string | null;
}
export interface AssignmentQueuePage {
  items: readonly AssignmentQueueRow[];
  nextCursor: string | null;
}
/** Future authorized API adapters must use apiJson and map an approved response
 * into this model. There is deliberately no endpoint, fetch or default data here.
 * Identity/ownership must be enforced by the server, never passed as a client filter.
 */
export type AssignmentQueueLoader = (input: { cursor: string | null; signal: AbortSignal }) => Promise<AssignmentQueuePage>;

export function validateQueueView(page: AssignmentQueuePage): void {
  if (!page || !Array.isArray(page.items) || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor)))
    throw new Error("Invalid queue presentation data");
  const ids = new Set<string>();
  for (const row of page.items) {
    if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id) ||
      !Object.hasOwn(assignmentStatusLabels, row.status) ||
      (row.dueAt !== null && (typeof row.dueAt !== "string" || !Number.isFinite(Date.parse(row.dueAt)))))
      throw new Error("Invalid assignment presentation data");
    ids.add(row.id);
  }
}

export function queueFailure(error: unknown): { title: string; message: string } {
  if (error instanceof ApiError) {
    if (error.code === "MODERATOR_QUEUE_SCOPE_PENDING") return { title: "Moderator scope unavailable", message: "Server-managed scope membership is not configured. No assignments were loaded." };
    if (error.code === "MODERATOR_QUEUE_PROVISIONING_UNAVAILABLE") return { title: "Moderator queue unavailable", message: "Trusted moderator provisioning is not configured for this deployment. No assignments were loaded." };
    if (error.code === "ASSIGNMENT_ASSURANCE_REQUIRED") return { title: "Assignment confirmation unavailable", message: "The server could not confirm the required staff assurance. No candidate was confirmed and no assignment was created." };
    if (error.code === "ASSIGNMENT_ASSURANCE_UNAVAILABLE") return { title: "Assignment was not created", message: "Trusted staff assurance is unavailable for this deployment. No assignment was created; try again only after the service is configured." };
    if (error.code === "ASSIGNMENT_EVIDENCE_UNAVAILABLE") return { title: "Candidate could not be confirmed", message: "The server could not verify the required qualification evidence. No candidate was confirmed and no assignment was created." };
    if (error.status === 401) return { title: "Sign in required", message: "Verify your session before loading assignments again." };
    if (error.status === 403) return { title: "Assignment access denied", message: "Your session does not have the required permissions or assurance." };
    if (error.status === 429) return { title: "Please wait before retrying", message: "The queue request was rate limited. Retry manually when the wait ends." };
    if (error.status === 503) return { title: "Assignment queue unavailable", message: "The service could not confirm access or availability. Retry later." };
  }
  return { title: "Assignments could not be loaded", message: "The queue could not be confirmed. Refresh to try again." };
}
