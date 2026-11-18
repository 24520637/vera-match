import { blockInput, cursor, reportInput } from "./safety.validation";
const valid = {
  targetUserId: "synthetic-target",
  reason: "HARASSMENT",
  details: "SYNTHETIC report details",
};
describe("Safety input boundaries", () => {
  it("normalizes bounded text and keeps markup as literal evidence", () => {
    expect(
      reportInput({
        ...valid,
        details: "  Synthetic <script>literal</script>\r\ntext  ",
      }).details,
    ).toBe("Synthetic <script>literal</script>\ntext");
    expect(
      reportInput({ ...valid, details: "😀".repeat(2000) }).details,
    ).toHaveLength(4000);
  });
  it.each([
    null,
    [],
    { ...valid, reporterId: "other" },
    { ...valid, status: "RESOLVED" },
    { ...valid, reason: "UNKNOWN" },
    { ...valid, details: "short" },
    { ...valid, details: "😀".repeat(2001) },
    { ...valid, details: "private X-Amz-Signature=synthetic" },
    { ...valid, details: "bad\u0000character" },
  ])("rejects malformed/forged report %#", (value) =>
    expect(() => reportInput(value)).toThrow(),
  );
  it.each(["", [], "bad!", "a".repeat(301)])(
    "rejects malformed cursor %#",
    (value) => expect(() => cursor(value)).toThrow(),
  );
  it("rejects forged block owners", () =>
    expect(() =>
      blockInput({ targetUserId: "valid", blockerId: "forged" }),
    ).toThrow());
});
