import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";

const invalid = (): never => { throw new BadRequestException({ code: "INVALID_REQUEST", message: "Check the connection fields." }); };
function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) return invalid();
  return value as Record<string, unknown>;
}

export async function connectionSharingInput(value: unknown) {
  const input = fields(value, ["expectedRevision", "profileShared", "contactShared", "chatEnabled", "photo"]);
  if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0 ||
      (input.expectedRevision as number) >= 2147483647 ||
      ["profileShared", "contactShared", "chatEnabled"].some(key => typeof input[key] !== "boolean")) return invalid();
  let photo: Buffer | null | undefined;
  if (input.photo === null) photo = null;
  else if (input.photo !== undefined) {
    if (typeof input.photo !== "string" || input.photo.length > 65536 ||
        !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.photo)) return invalid();
    const encoded = input.photo.slice(input.photo.indexOf(",") + 1);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) return invalid();
    try {
      const image = sharp(bytes, { limitInputPixels: 1048576, animated: false });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) return invalid();
      photo = await image.rotate().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
      if (photo.length > 65536) return invalid();
    } catch { return invalid(); }
  }
  return {
    expectedRevision: input.expectedRevision as number,
    profileShared: input.profileShared as boolean,
    contactShared: input.contactShared as boolean,
    chatEnabled: input.chatEnabled as boolean,
    photo: photo ? new Uint8Array(photo) : photo,
  };
}

export function connectionMessageInput(value: unknown) {
  const input = fields(value, ["clientMessageId", "text"]);
  if (typeof input.clientMessageId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.clientMessageId) ||
      typeof input.text !== "string") return invalid();
  const text = input.text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (!text || text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return invalid();
  return { clientMessageId: input.clientMessageId.toLowerCase(), text };
}

export function connectionMessagesQuery(value: unknown) {
  const input = fields(value, ["before"]);
  if (input.before !== undefined && (typeof input.before !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.before))) return invalid();
  return input.before as string | undefined;
}
