import { createHash } from "node:crypto";

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Opaque 32-byte base64url tokens: reject ambiguous/duplicate/oversized cookie input. */
export function readSessionToken(
  header: unknown,
  cookieName: string,
): string | null {
  if (typeof header !== "string" || header.length > 8192) return null;
  const matches = header
    .split(";")
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.indexOf("=") > 0 &&
        part.slice(0, part.indexOf("=")) === cookieName,
    );
  if (matches.length !== 1) return null;
  const token = matches[0].slice(matches[0].indexOf("=") + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const decoded = Buffer.from(token, "base64url");
  return decoded.length === 32 && decoded.toString("base64url") === token
    ? token
    : null;
}
