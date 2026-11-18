import { candidateQuery, queueQuery } from "./assignment-queues.validation";

describe("C035 strict read DTOs", () => {
  test("accepts a known pair and optional queue status/cursor", () => {
    expect(candidateQuery({ videoId: "video", expertId: "expert" })).toEqual({ videoId: "video", expertId: "expert" });
    expect(queueQuery({ status: "ASSIGNED", cursor: Buffer.from("job").toString("base64url") })).toEqual({ status: "ASSIGNED", after: "job" });
  });
  test.each([{ userId: "other" }, { status: ["ASSIGNED", "CANCELLED"] }, { cursor: "!!!!" }, { status: "UNKNOWN" }])("rejects client scope and malformed query %j", value => {
    expect(() => queueQuery(value)).toThrow();
  });
  test.each([{ videoId: "video", expertId: "expert", mfa: true }, { videoId: "../video", expertId: "expert" }, { videoId: "video" }])("rejects invalid candidate query %j", value => {
    expect(() => candidateQuery(value)).toThrow();
  });
});
