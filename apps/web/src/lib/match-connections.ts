export type ConnectionSharing = {
  revision: number;
  profileShared: boolean;
  contactShared: boolean;
  chatEnabled: boolean;
  photo: string | null;
};
export type SharedMatchProfile = {
  displayName: string | null;
  age: number;
  occupation: string | null;
  city: string | null;
  bio: string | null;
  relationshipGoal: string | null;
  interests: string[];
  values: string[];
  photo: string | null;
};
export type MatchConnection = {
  sharing: ConnectionSharing;
  peer: { profile: SharedMatchProfile | null; contactEmail: string | null; chatEnabled: boolean };
  chatAvailable: boolean;
};
export type ConnectionMessage = {
  id: string;
  clientMessageId: string | null;
  sender: "me" | "peer";
  text: string;
  createdAt: string;
};
export type ConnectionMessages = { messages: ConnectionMessage[]; nextCursor: string | null };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const nullableString = (value: unknown) => value === null || typeof value === "string";
const photo = (value: unknown) => value === null || typeof value === "string" &&
  value.length <= 90000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
export function isMatchConnection(value: unknown): value is MatchConnection {
  if (!record(value) || !record(value.sharing) || !record(value.peer) || typeof value.chatAvailable !== "boolean") return false;
  const own = value.sharing, peer = value.peer;
  if (!Number.isSafeInteger(own.revision) || (own.revision as number) < 0 ||
    [own.profileShared, own.contactShared, own.chatEnabled, peer.chatEnabled].some(flag => typeof flag !== "boolean") ||
    !photo(own.photo) || !nullableString(peer.contactEmail)) return false;
  if (value.chatAvailable !== (own.chatEnabled && peer.chatEnabled)) return false;
  if (peer.profile === null) return true;
  const p = peer.profile;
  return record(p) && nullableString(p.displayName) && Number.isInteger(p.age) && (p.age as number) >= 18 && (p.age as number) <= 120 &&
    [p.occupation, p.city, p.bio, p.relationshipGoal].every(nullableString) && photo(p.photo) &&
    [p.interests, p.values].every(list => Array.isArray(list) && list.every(item => typeof item === "string"));
}
export function isConnectionMessage(value: unknown): value is ConnectionMessage {
  return record(value) && typeof value.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.id) &&
    nullableString(value.clientMessageId) && ["me", "peer"].includes(value.sender as string) &&
    typeof value.text === "string" && value.text.length > 0 && value.text.length <= 2000 &&
    typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}
export function isConnectionMessages(value: unknown): value is ConnectionMessages {
  return record(value) && Array.isArray(value.messages) && value.messages.length <= 50 &&
    value.messages.every(isConnectionMessage) && (value.nextCursor === null ||
      typeof value.nextCursor === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.nextCursor));
}

export async function resizeConnectionPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error("Choose a JPEG, PNG or WebP image up to 5 MB.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The photo could not be resized.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/webp", 0.75);
    if (!data.startsWith("data:image/webp;base64,") || data.length > 65536) throw new Error("Choose a smaller photo.");
    return data;
  } finally { bitmap.close(); }
}
