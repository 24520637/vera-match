import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";
import { connectionMessageInput, connectionMessagesQuery, connectionSharingInput } from "./match-connection.validation";

const flags = { expectedRevision: 0, profileShared: false, contactShared: false, chatEnabled: false };
const id = "c252ab58-0c44-4abc-9524-374bd86d147c";
describe("mutual connection input boundaries", () => {
  it("normalizes plain text and rejects forged identity, controls, empty and oversized messages", () => {
    expect(connectionMessageInput({ clientMessageId: id.toUpperCase(), text: "  cafe\u0301\r\nHello  " }))
      .toEqual({ clientMessageId: id, text: "café\nHello" });
    for (const text of [" ", "x".repeat(2001), "hello\u0000world"]) {
      expect(() => connectionMessageInput({ clientMessageId: id, text })).toThrow(BadRequestException);
    }
    expect(() => connectionMessageInput({ clientMessageId: id, text: "Hello", senderId: "forged" })).toThrow();
    expect(() => connectionMessageInput({ clientMessageId: "not-a-uuid", text: "Hello" })).toThrow();
  });
  it("requires explicit booleans and revision, rejecting unexpected recipient fields", async () => {
    await expect(connectionSharingInput(flags)).resolves.toMatchObject(flags);
    for (const body of [{ ...flags, expectedRevision: -1 }, { ...flags, chatEnabled: "true" },
      { ...flags, userId: "forged" }, { expectedRevision: 0 }]) {
      await expect(connectionSharingInput(body)).rejects.toThrow(BadRequestException);
    }
    expect(() => connectionMessagesQuery({ before: ["a", "b"] })).toThrow();
    expect(() => connectionMessagesQuery({ senderId: "forged" })).toThrow();
  });
  it("decodes and re-encodes photos as small metadata-free WebP", async () => {
    const source = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#78426f" } })
      .withMetadata().jpeg().toBuffer();
    const result = await connectionSharingInput({ ...flags, photo: "data:image/jpeg;base64," + source.toString("base64") });
    expect(result.photo).toBeInstanceOf(Uint8Array);
    const metadata = await sharp(result.photo!).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 256 });
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined();
    await expect(connectionSharingInput({ ...flags, photo: "data:image/png;base64," + Buffer.from("invalid").toString("base64") })).rejects.toThrow();
    await expect(connectionSharingInput({ ...flags, photo: "data:image/svg+xml;base64,PHN2Zy8+" })).rejects.toThrow();
    const huge = await sharp({ create: { width: 1100, height: 1100, channels: 3, background: "white" } }).png().toBuffer();
    await expect(connectionSharingInput({ ...flags, photo: "data:image/png;base64," + huge.toString("base64") })).rejects.toThrow();
  });
});
