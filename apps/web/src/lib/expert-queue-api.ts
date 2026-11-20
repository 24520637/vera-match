import { apiJson, ApiError } from "./api";
import { validateQueueView, type AssignmentQueueLoader, type AssignmentQueueRow } from "./expert-queue-view";

interface QueueResponse { assignments: AssignmentQueueRow[]; nextCursor: string | null }
export interface AssignmentCandidate { videoId: string; expertId: string; expectedCredentialRevision: number }
export interface AssignmentRequest extends AssignmentCandidate { dueAt: string | null; expiresAt: string | null }
export interface AssignmentReceipt { assignment: { id: string; videoId: string; expertId: string; status: "ASSIGNED"; revision: number;
  credentialApprovalId: string; dueAt: string | null; expiresAt: string | null } }
function invalid(): never { throw new ApiError("invalid-response", "Assignment data could not be confirmed."); }
const reference = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const date = (value: unknown) => value === null || (typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

function loader(path: string): AssignmentQueueLoader {
  return async ({ cursor, signal }) => {
    const value = await apiJson<QueueResponse>(path + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""), { signal });
    if (!value) invalid();
    const page = { items: value.assignments, nextCursor: value.nextCursor };
    validateQueueView(page);
    if (page.items.some(row => !reference(row.id) || !date(row.dueAt))) invalid();
    return page;
  };
}
export const loadExpertAssignments = loader("/expert/assignments/me");
export const loadModeratorAssignments = loader("/expert-admin/assignments");
export async function checkAssignmentCandidate(videoId: string, expertId: string, signal: AbortSignal) {
  const value = await apiJson<{ candidate: AssignmentCandidate }>("/expert-admin/assignments/candidate?" + new URLSearchParams({ videoId, expertId }), { signal });
  const row = value?.candidate;
  if (!row || !reference(row.videoId) || !reference(row.expertId) || row.videoId !== videoId || row.expertId !== expertId ||
    !Number.isSafeInteger(row.expectedCredentialRevision) || row.expectedCredentialRevision < 0) invalid();
  return row;
}
export async function createAssignment(body: AssignmentRequest, key: string) {
  const value = await apiJson<AssignmentReceipt>("/expert-admin/assignments", { method: "POST", headers: { "Idempotency-Key": key }, json: body });
  const row = value?.assignment;
  if (!row || !reference(row.id) || row.videoId !== body.videoId || row.expertId !== body.expertId || row.status !== "ASSIGNED" ||
    row.revision !== 0 || typeof row.credentialApprovalId !== "string" || !date(row.dueAt) || !date(row.expiresAt) ||
    row.dueAt !== body.dueAt || row.expiresAt !== body.expiresAt) invalid();
  return value;
}
