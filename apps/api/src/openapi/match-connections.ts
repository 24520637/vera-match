import { array, boolean, nullable, object, OwnedOperation, revision, string, timestamp } from "./operation";

const handle = { type: "string", minLength: 1, maxLength: 768, pattern: "^[A-Za-z0-9_-]+$" };
const photo = nullable({ type: "string", maxLength: 90000, description: "Small WebP data URL. Private to this connection." });
const sharing = object({ revision, profileShared: boolean, contactShared: boolean, chatEnabled: boolean, photo });
const profile = object({
  displayName: nullable(string), age: { type: "integer", minimum: 18, maximum: 120 },
  occupation: nullable(string), city: nullable(string), bio: nullable(string), relationshipGoal: nullable(string),
  interests: array(string), values: array(string), photo,
});
const message = object({ id: string, clientMessageId: nullable({ type: "string", format: "uuid" }),
  sender: { type: "string", enum: ["me", "peer"] }, text: { type: "string", maxLength: 2000 }, createdAt: timestamp });
const path = { name: "connectionId", schema: handle,
  description: "Temporary connection reference from mutual decision history. Bound to the account/session and expires after 15 minutes." };
const description = "Requires two current ACCEPT decisions, reciprocal eligibility, active matching consent and an unblocked pair. Every request rechecks access. A block permanently closes this pair’s connection, including after unblock. Profile, contact and chat sharing default to off for existing and new pairs.";
const errors = { 400: ["INVALID_REQUEST"], 404: ["MATCH_UNAVAILABLE"], 503: ["MATCHING_UNAVAILABLE", "SAFETY_STORE_UNAVAILABLE"] };

export const ApiMatchConnection = () => OwnedOperation({
  summary: "Read a mutual connection and its explicitly shared profile", role: "MEMBER", path,
  description,
  response: object({ sharing, peer: object({ profile: nullable(profile), contactEmail: nullable({ type: "string", format: "email" }), chatEnabled: boolean }), chatAvailable: boolean }),
  errors,
});
export const ApiConnectionSharing = () => OwnedOperation({
  summary: "Set my profile, contact and chat sharing for one mutual match", role: "MEMBER", path,
  origin: "required", rejectCrossSite: true,
  description: description + " Shared contact is the owner's account email. Photo input is optional, a JPEG/PNG/WebP data URL of at most 65536 characters. The server validates and re-encodes it to remove metadata. Omit photo to keep it, send null to remove. expectedRevision=0 initializes a new owner's settings. Turning sharing off restricts future reads; recipients may retain information already seen.",
  body: { ...object({ expectedRevision: { type: "integer", minimum: 0, maximum: 2147483646 },
    profileShared: boolean, contactShared: boolean, chatEnabled: boolean,
    photo: nullable({ type: "string", maxLength: 65536 }),
  }, ["expectedRevision", "profileShared", "contactShared", "chatEnabled"]),
    example: { expectedRevision: 0, profileShared: true, contactShared: false, chatEnabled: true } },
  response: object({ sharing }), errors: { ...errors, 409: ["CONNECTION_REVISION_CONFLICT"] },
});
export const ApiConnectionMessages = () => OwnedOperation({
  summary: "Read messages in a mutual connection", role: "MEMBER", path,
  description: description + " Both members must enable chat. Returns the newest 50 messages in chronological order; use nextCursor as before for older pages. Turning chat off hides conversation access for both people.",
  query: [{ name: "before", schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" } }],
  response: object({ messages: array(message, 50), nextCursor: nullable(string) }),
  errors: { ...errors, 403: ["CHAT_NOT_ENABLED"] },
});
export const ApiSendConnectionMessage = () => OwnedOperation({
  summary: "Send a text message to a mutual match", role: "MEMBER", path, status: 201,
  origin: "required", rejectCrossSite: true,
  description: description + " Both members must enable chat. clientMessageId is a UUID v4 generated once per message. Retry with the same ID and text after an uncertain response; exact retries return the original receipt. A reused ID with different normalized text is rejected. Plain text is 1–2000 UTF-16 code units after NFC normalization and trimming.",
  body: { ...object({ clientMessageId: { type: "string", format: "uuid" }, text: { type: "string", minLength: 1, maxLength: 2000 } }),
    example: { clientMessageId: "c252ab58-0c44-4abc-9524-374bd86d147c", text: "Hello, nice to meet you." } },
  response: object({ message }), errors: { ...errors, 403: ["CHAT_NOT_ENABLED"], 409: ["MESSAGE_ID_REUSED"] },
});
