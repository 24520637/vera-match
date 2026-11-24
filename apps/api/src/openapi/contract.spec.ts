import { huongContracts } from "./huong-contracts";
import type { INestApplication } from "@nestjs/common";
import type { OpenAPIObject, RequestBodyObject, ResponseObject, SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { Test } from "@nestjs/testing";
import { configureApplication } from "../configure-app";
import { parseConsentPatch } from "../consent/consent.validation";
import { PrismaService } from "../database/prisma.service";
import { parseAssignment } from "../expert-admin/assignment.validation";
import { grantInput, revokeInput } from "../expert-admin/assignment-grants.validation";
import { parseExpertApproval } from "../expert-admin/expert-approval.validation";
import { claimFeedback, claimUpdate, reviewApproval } from "../expert-admin/review-claim.validation";
import { disputeDecision, disputeInput } from "../expert-admin/review-dispute";
import { draftPatch, observationPost, requireEmpty, reviewReturn, reviewSubmit } from "../expert-admin/review-draft.validation";
import { parsePreferencesPatch } from "../preferences/preferences.validation";
import { parseProfilePatch } from "../profile/profile.validation";
import { QuestionnaireCatalog } from "../questionnaire/questionnaire.catalog";
import { parseQuestionnairePut } from "../questionnaire/questionnaire.validation";
import { configureSwagger } from "./configure-swagger";

const routes = [
  ["get", "/api/consents/me", 200],
  ["get", "/api/consents/policies", 200],
  ["patch", "/api/consents/me", 200, parseConsentPatch],
  ["post", "/api/expert-admin/experts/{userId}/approvals", 201, parseExpertApproval],
  ["post", "/api/expert-admin/assignments", 201, parseAssignment],
  ["get", "/api/expert-admin/assignments", 200],
  ["get", "/api/expert-admin/assignments/candidate", 200],
  ["post", "/api/expert-admin/assignment-grants", 201, grantInput],
  ["post", "/api/expert-admin/assignment-grants/revoke", 200, revokeInput],
  ["get", "/api/expert/assignments/me", 200],
  ["post", "/api/expert/assignments/{assignmentId}/playback", 200, requireEmpty],
  ["get", "/api/expert/assignments/{id}/draft", 200],
  ["post", "/api/expert/assignments/{id}/draft", 200, requireEmpty],
  ["patch", "/api/expert/reviews/{id}/draft", 200, draftPatch],
  ["post", "/api/expert/reviews/{id}/observations", 200, observationPost],
  ["post", "/api/expert/reviews/{id}/submit", 200, reviewSubmit],
  ["get", "/api/qa/reviews", 200],
  ["get", "/api/qa/reviews/{id}", 200],
  ["post", "/api/qa/reviews/{id}/return", 200, reviewReturn],
  ["post", "/api/qa/reviews/{id}/approve", 200, reviewApproval],
  ["get", "/api/qa/reviews/disputes", 200],
  ["get", "/api/qa/reviews/disputes/{id}", 200],
  ["patch", "/api/qa/reviews/disputes/{id}", 200, disputeDecision],
  ["get", "/api/reviews/me", 200],
  ["patch", "/api/reviews/claims/{id}", 200, claimUpdate],
  ["patch", "/api/reviews/claims/{id}/feedback", 200, claimFeedback],
  ["post", "/api/reviews/{id}/disputes", 201, disputeInput],
  ["get", "/api/matches/recommendations", 200],
  ["post", "/api/matches/{pairId}/decision", 200],
  ["get", "/api/matches/decisions", 200],
  ["get", "/api/profile/me", 200],
  ["patch", "/api/profile/me", 200, parseProfilePatch],
  ["get", "/api/questionnaire/me", 200],
  ["put", "/api/questionnaire/me", 200, (input: unknown) => parseQuestionnairePut(input, new QuestionnaireCatalog())],
  ["get", "/api/preferences/me", 200],
  ["patch", "/api/preferences/me", 200, parsePreferencesPatch],
] as const;

type Method = (typeof routes)[number][0];

describe("Phúc's generated OpenAPI contract", () => {
  let app: INestApplication;
  let document: OpenAPIObject;
  let base: string;

  beforeAll(async () => {
    const env = jest.replaceProperty(process, "env", {
      ...process.env,
      NODE_ENV: "test",
      SESSION_COOKIE_NAME: "vera_contract_session",
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5433/not_connected",
      MINIO_ROOT_USER: "synthetic",
      MINIO_ROOT_PASSWORD: "synthetic-only",
    });
    try {
      const { AppModule } = await import("../app.module");
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService).useValue({}).compile();
      app = module.createNestApplication({ logger: false });
      configureApplication(app);
      configureSwagger(app);
      await app.listen(0, "127.0.0.1");
      base = await app.getUrl();
      const json = await fetch(base + "/api/docs-json");
      expect(json.status).toBe(200);
      expect(json.headers.get("content-type")).toMatch(/^application\/json/);
      document = await json.json() as OpenAPIObject;
    } finally {
      env.restore();
    }
  }, 30000);

  afterAll(async () => { await app?.close(); });

  function operation(method: Method, path: string) {
    const found = document.paths[path]?.[method];
    if (!found) throw new Error("Missing operation " + method + " " + path);
    return found;
  }

  function body(method: Method, path: string) {
    const request = operation(method, path).requestBody as RequestBodyObject;
    expect(request.required).toBe(true);
    return request.content["application/json"].schema as SchemaObject;
  }

  function response(method: Method, path: string, status: number) {
    return operation(method, path).responses[status] as ResponseObject;
  }

  it("has the same paths and verbs as the registered NestJS HTTP routes", () => {
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const stack: Layer[] = app.getHttpAdapter().getInstance()._router.stack;
    const swaggerPaths = new Set([
      "/api/docs", "/api/docs-json", "/api/docs-yaml",
      "/api/docs/swagger-ui-init.js", "/api/docs/docs/swagger-ui-init.js",
    ]);
    const registered = new Set(stack.flatMap(({ route }) => {
      if (!route) return [];
      // Express also registers the trailing-slash form for empty Nest method paths.
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/$/, "");
      if (swaggerPaths.has(path)) return [];
      return Object.keys(route.methods).map(method => method + " " + path);
    }));
    const generated = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item).map(method => method + " " + path));
    expect(document.openapi).toMatch(/^3\.0\./);
    expect(generated.sort()).toEqual([...registered].sort());

    const tagged = Object.entries(document.paths).flatMap(([path, item]) =>
      (["get", "post", "patch", "put", "delete"] as const)
        .filter(method => item[method]?.description?.startsWith("Requires a valid HttpOnly session cookie"))
        .map(method => method + " " + path));
    expect(tagged.sort()).toEqual(routes.map(([method, path]) => method + " " + path).sort());
    expect(routes).toHaveLength(36);
  });

  it("declares the configured cookie and requires it on every documented protected operation", () => {
    expect(document.components?.securitySchemes).toEqual({
      sessionCookie: { type: "apiKey", in: "cookie", name: "vera_contract_session" },
    });
    expect(document.security).toBeUndefined();
    const secured = Object.entries(document.paths).flatMap(([path, item]) =>
      (["get", "post", "patch", "put", "delete"] as const)
        .filter(method => item[method]?.security?.some(requirement => "sessionCookie" in requirement))
        .map(method => method + " " + path));
    expect(secured.sort()).toEqual([...routes.map(([method, path]) => method + " " + path), ...huongContracts.filter(c => c.security).map(c => c.method + " " + c.path)].sort());
  });

  it("describes every operation and represents an empty JSON body without an empty required list", () => {
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of ["get", "post", "patch", "delete", "put"] as const) {
        const entry = item[method];
        if (!entry) continue;
        expect([method, path, entry.summary?.trim(), entry.description?.trim()]).toEqual([
          method, path, expect.stringMatching(/\S/), expect.stringMatching(/\S/),
        ]);
        const schema = (entry.requestBody as RequestBodyObject | undefined)?.content["application/json"]?.schema as SchemaObject | undefined;
        if (schema?.required) expect(schema.required.length).toBeGreaterThan(0);
      }
    }
  });

  it("serves the existing Swagger UI and YAML without requiring a session", async () => {
    const [ui, yaml] = await Promise.all([
      fetch(base + "/api/docs"),
      fetch(base + "/api/docs-yaml"),
    ]);
    expect(ui.status).toBe(200);
    expect(ui.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await ui.text()).toContain("swagger-ui-init.js");
    expect(yaml.status).toBe(200);
    expect(yaml.headers.get("content-type")).toMatch(/yaml/);
    const source = await yaml.text();
    expect(source).toContain("sessionCookie:");
    expect(source).toContain("name: vera_contract_session");
  });

  it("still rejects an unauthenticated request to an operation with sessionCookie metadata", async () => {
    const response = await fetch(base + "/api/profile/me");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it.each([
    { method: "patch", path: "/api/profile/me", status: 400, contentType: "application/json", body: "{" },
    { method: "patch", path: "/api/profile/me", status: 413, contentType: "application/json",
      body: JSON.stringify({ bio: "x".repeat(110_000) }) },
    { method: "patch", path: "/api/profile/me", status: 415, contentType: "application/json; charset=iso-8859-1", body: "{}" },
    { method: "get", path: "/api/qa/reviews/{id}", status: 400, requestPath: "/api/qa/reviews/%FF" },
  ] as const)("matches the framework $status response for $method $path", async (testCase) => {
    const { method, path, status } = testCase;
    const result = await fetch(base + (testCase.requestPath ?? path), {
      method: method.toUpperCase(),
      ...(testCase.method === "patch" ? { headers: { "Content-Type": testCase.contentType }, body: testCase.body } : {}),
    });
    expect(result.status).toBe(status);
    const payload = await result.json() as Record<string, unknown>;
    const schema = response(method, path, status).content?.["application/json"].schema as SchemaObject;
    const framework = (schema.oneOf ?? [schema]).find(candidate =>
      "properties" in candidate && "statusCode" in (candidate.properties ?? {}),
    ) as SchemaObject | undefined;
    const expectedFields = status === 400 ? ["error", "message", "statusCode"] : ["message", "statusCode"];
    expect(framework?.required?.slice().sort()).toEqual(expectedFields);
    expect(Object.keys(payload).sort()).toEqual(expectedFields);
    expect(payload).toMatchObject({ statusCode: status, message: expect.any(String) });
    if (status === 400) expect(payload.error).toBe("Bad Request");
  });

  it.each(routes)("documents %s %s", (...[method, path, status, validate]) => {
    const found = operation(method, path);
    expect(found.security).toEqual([{ sessionCookie: [] }]);
    expect(found.tags).toHaveLength(1);
    expect(found.summary).toBeTruthy();
    expect(found.description).toMatch(/active, email-verified (MEMBER|MODERATOR|EXPERT|ADMIN) account/);
    expect(Object.keys(found.responses).filter(code => code.startsWith("2"))).toEqual([String(status)]);
    expect(response(method, path, status).content?.["application/json"].schema).toBeDefined();
    expect(Object.keys(found.responses)).toEqual(expect.arrayContaining(["400", "401", "403", "429", "503"]));
    expect(response(method, path, 429).headers).toHaveProperty("Retry-After");

    const params = (found.parameters ?? []).filter(item => "in" in item);
    const pathNames = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
    expect(params.filter(param => param.in === "path").map(param => [param.name, param.required]))
      .toEqual(pathNames.map(name => [name, true]));
    if (method === "get") {
      expect(found.requestBody).toBeUndefined();
      expect(found.responses["415"]).toBeUndefined();
    } else {
      expect(params).toContainEqual(expect.objectContaining({ in: "header", name: "Origin", required: true }));
      expect(response(method, path, 415).description).toContain("JSON_REQUIRED");
      const schema = body(method, path);
      expect(schema.example).toBeDefined();
      if (validate) expect(() => validate(schema.example)).not.toThrow();
    }
  });

  it("publishes exact paging, idempotency, and timecode metadata", () => {
    const queries = (path: string) => operation("get", path).parameters?.filter(param => "in" in param && param.in === "query");
    expect(queries("/api/expert-admin/assignments")).toEqual([
      expect.objectContaining({ name: "cursor", required: false, schema: expect.objectContaining({ maxLength: 300 }) }),
      expect.objectContaining({ name: "status", required: false }),
    ]);
    expect(queries("/api/expert-admin/assignments/candidate")).toEqual([
      expect.objectContaining({ name: "videoId", required: true }),
      expect.objectContaining({ name: "expertId", required: true }),
    ]);
    expect(queries("/api/matches/recommendations")).toEqual([
      expect.objectContaining({ name: "after", required: false }),
    ]);
    expect(queries("/api/questionnaire/me")).toEqual([
      expect.objectContaining({ name: "questionnaireVersion", required: false }),
    ]);
    expect(operation("patch", "/api/consents/me").parameters).toContainEqual(
      expect.objectContaining({ name: "Idempotency-Key", required: true }),
    );
    expect(operation("get", "/api/expert-admin/assignments").parameters).toContainEqual(
      expect.objectContaining({ name: "Origin", in: "header", required: false }),
    );
    expect(operation("get", "/api/expert-admin/assignments").parameters).toContainEqual(
      expect.objectContaining({ name: "Sec-Fetch-Site", in: "header", required: false }),
    );
    expect(response("patch", "/api/consents/me", 200).headers).toHaveProperty("Idempotency-Replayed");
    expect(response("post", "/api/expert/reviews/{id}/observations", 422).description).toContain("INVALID_OBSERVATION_TIMECODE");
    expect(response("post", "/api/expert/reviews/{id}/observations", 503).description).toContain("REVIEW_DURATION_UNAVAILABLE");
  });

  it("documents the signed source and separate authorization gates for expert review workflows", () => {
    const approval = operation("post", "/api/expert-admin/experts/{userId}/approvals");
    expect(approval.description).toContain("active, email-verified MODERATOR");
    expect(approval.description).toContain("Outside tests, the moderator needs current session-bound MFA");
    expect(response("post", "/api/expert-admin/experts/{userId}/approvals", 403).description)
      .toContain("STAFF_ASSURANCE_REQUIRED");
    expect(approval.description).toContain("operator-installed qualification publication verified against a trusted Ed25519 public key");
    expect(approval.description).toContain("Evidence must match the target expert, version and purpose");
    expect(operation("post", "/api/expert/assignments/{assignmentId}/playback").description)
      .toContain("Requires the assigned expert, current qualification, session-bound MFA, and matching storage and review consent generations");
    expect(operation("get", "/api/expert-admin/assignments").description)
      .toContain("grants must be bound to the moderator's current trusted staff identity and MFA enrollment epoch");
    expect(operation("get", "/api/qa/reviews").description)
      .toContain("Trusted staff MFA does not confer assignment scope on its own");
  });

  it("matches the validator's optional policy binding strings for withdrawals", () => {
    const request = body("patch", "/api/consents/me");
    const itemSchema = (variant: unknown) => {
      const variantSchema = variant as SchemaObject;
      return (variantSchema.properties?.consents as SchemaObject).items as SchemaObject;
    };
    const grant = itemSchema(request.oneOf?.[0]);
    const withdraw = itemSchema(request.oneOf?.[1]);
    expect(withdraw.required).toEqual(["purpose", "granted"]);
    expect(withdraw.properties).toMatchObject({
      granted: { enum: [false] },
      locale: { type: "string" },
      policyDigest: { type: "string" },
    });
    expect(withdraw.properties?.locale).toEqual({ type: "string" });
    expect(withdraw.properties?.policyDigest).toEqual({ type: "string" });
    expect(grant.required).toEqual(["purpose", "granted", "policyVersion", "locale", "policyDigest"]);
    expect(grant.properties).toMatchObject({
      granted: { enum: [true] },
      locale: { enum: ["en", "vi"] },
      policyDigest: { pattern: "^[a-f0-9]{64}$" },
    });
    const withdrawal = { purpose: "VIDEO_STORAGE", granted: false, locale: "legacy-locale", policyDigest: "legacy-digest" };
    expect(parseConsentPatch({ expectedVersion: 0, consents: [withdrawal] }).consents).toEqual([withdrawal]);
  });

  it("preserves private response projections, nulls, and documented examples", () => {
    const schema = (method: Method, path: string, status: number) =>
      response(method, path, status).content?.["application/json"].schema as SchemaObject;
    expect(schema("get", "/api/profile/me", 200)).toMatchObject({
      required: ["revision", "profile"], properties: { profile: { nullable: true } },
      example: { revision: 0, profile: null },
    });
    expect(schema("patch", "/api/preferences/me", 503).oneOf).toContainEqual(expect.objectContaining({
      required: ["code", "message", "details", "resource", "revision", "remediation"],
    }));
    expect(schema("get", "/api/expert/assignments/{id}/draft", 200).oneOf).toEqual([
      expect.objectContaining({ required: ["draft", "durationMs"] }),
      expect.objectContaining({ required: ["draft", "submission", "durationMs"] }),
    ]);
    const nullObject = { type: "object", nullable: true, enum: [null] };
    expect(schema("get", "/api/qa/reviews/disputes/{id}", 200).oneOf).toEqual([
      expect.objectContaining({ properties: expect.objectContaining({
        report: expect.objectContaining({ type: "object", required: ["version", "summary", "limitations", "approvedAt"] }),
        claim: nullObject,
      }) }),
      expect.objectContaining({ properties: expect.objectContaining({
        report: nullObject,
        claim: expect.objectContaining({ type: "object", required: ["statement", "evidence"] }),
      }) }),
    ]);
    expect(schema("post", "/api/expert/assignments/{assignmentId}/playback", 200).required)
      .toEqual(["id", "url", "expiresAt"]);
    expect(schema("get", "/api/matches/recommendations", 200)).toMatchObject({
      properties: { recommendations: { items: { required: ["key", "pairId", "reasons"], additionalProperties: false } } },
      example: { available: false, recommendations: [], nextCursor: null },
    });
    expect(body("post", "/api/matches/{pairId}/decision")).toMatchObject({
      required: ["choice"], additionalProperties: false, properties: { choice: { enum: ["ACCEPT", "DECLINE"] } },
      example: { choice: "ACCEPT" },
    });
    expect(schema("post", "/api/matches/{pairId}/decision", 200).example).toEqual({ choice: "ACCEPT", mutual: false });
  });
});
