import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { SessionService } from "../auth/session.service";
import { EnvironmentService } from "../config/environment.service";
import { configureApplication } from "../configure-app";
import { ReviewDraftController } from "./review-draft.controller";
import { ReviewDraftService } from "./review-draft.service";
import { ReviewOwnerController } from "./review-owner.controller";
import { ReviewOwnerService } from "./review-owner.service";
import { ReviewQaController } from "./review-qa.controller";
import { ReviewQaService } from "./review-qa.service";

describe("C060 private review HTTP routes", () => {
  const origin = "http://localhost:3000";
  const tokens = Object.fromEntries((["MEMBER", "EXPERT", "MODERATOR", "ADMIN"] as const)
    .map((role, index) => [role, Buffer.alloc(32, index + 1).toString("base64url")])) as Record<UserRole, string>;
  const sessions = new Map(Object.entries(tokens).map(([role, token]) => [token, {
    sessionId: role, user: { id: role, role, email: "synthetic@example.invalid", displayName: null },
  }]));
  const owner = { list: jest.fn(async () => ({ reports: [], nextCursor: null })) };
  const qa = { approve: jest.fn(async () => ({ status: "APPROVED" })) };
  const drafts = { submit: jest.fn(async () => ({ status: "SUBMITTED" })) };
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ReviewDraftController, ReviewQaController, ReviewOwnerController],
      providers: [
        { provide: EnvironmentService, useValue: { values: { corsOrigin: origin, session: { cookieName: "test-session" } } } },
        { provide: SessionService, useValue: { resolve: async (token: string) => sessions.get(token) } },
        { provide: ReviewDraftService, useValue: drafts },
        { provide: ReviewQaService, useValue: qa },
        { provide: ReviewOwnerService, useValue: owner },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  afterAll(async () => { await app?.close(); });

  function request(path: string, role?: UserRole, body?: string, extra?: Record<string, string>) {
    return fetch(`${base}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(role ? { Cookie: `test-session=${tokens[role]}` } : {}),
        ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...extra },
      body,
    });
  }

  it("requires member ownership scope and keeps personalized report requests private", async () => {
    expect((await request("reviews/me")).status).toBe(401);
    expect((await request("reviews/me", "MODERATOR")).status).toBe(403);
    expect((await request("reviews/me?ownerId=foreign", "MEMBER")).status).toBe(400);
    const response = await request("reviews/me?after=review-1", "MEMBER");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(owner.list).toHaveBeenCalledTimes(1);
    expect(owner.list).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: "MEMBER" }) }), "review-1");
  });

  it("enforces moderator and expert roles, rejects cross-site writes and protects malformed JSON", async () => {
    const body = '{"expectedVersion":2}';
    expect((await request("qa/reviews/r/approve", "EXPERT", body)).status).toBe(403);
    expect((await request("qa/reviews/r/approve", "ADMIN", body)).status).toBe(403);
    expect((await request("qa/reviews/r/approve", "MODERATOR", body, { Origin: "https://foreign.invalid" })).status).toBe(403);
    const malformed = await request("qa/reviews/r/approve", "MODERATOR", "{");
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("cache-control")).toBe("private, no-store");
    expect((await request("qa/reviews/r/approve", "MODERATOR", body)).status).toBe(200);
    expect((await request("expert/reviews/r/submit", "MODERATOR", body)).status).toBe(403);
    expect((await request("expert/reviews/r/submit", "EXPERT", body)).status).toBe(200);
    expect(qa.approve).toHaveBeenCalledTimes(1);
    expect(drafts.submit).toHaveBeenCalledTimes(1);
  });
});
