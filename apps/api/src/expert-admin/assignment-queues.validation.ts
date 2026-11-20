import { AssignmentStatus } from "@prisma/client";
import { cursor, identifier, invalid, object } from "../safety/safety.validation";

export function queueQuery(value: unknown) {
  const query = object(value, ["cursor", "status"]);
  if (query.status !== undefined && (typeof query.status !== "string" || !Object.values(AssignmentStatus).includes(query.status as AssignmentStatus)))
    invalid("status", "Choose an assignment status.");
  return { after: cursor(query.cursor), status: query.status as AssignmentStatus | undefined };
}
export function candidateQuery(value: unknown) {
  const query = object(value, ["videoId", "expertId"]);
  return { videoId: identifier(query.videoId, "videoId"), expertId: identifier(query.expertId, "expertId") };
}
