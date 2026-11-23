import type { INestApplication } from "@nestjs/common";
import type { OpenAPIObject, RequestBodyObject, SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { Test } from "@nestjs/testing";
import { ReportReason } from "@prisma/client";
import { configureApplication } from "../configure-app";
import { PrismaService } from "../database/prisma.service";
import { configureSwagger } from "./configure-swagger";
import { huongContracts } from "./huong-contracts";
import { uploadInput } from "../video/video.validation";
import { closureInput } from "../account-closure/closure.validation";

describe("Huong owned OpenAPI release contracts", () => {
  let app: INestApplication;
  let document: OpenAPIObject;
  let base: string;
  beforeAll(async () => {
    const original = jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "test", API_DOCS_MODE: "public", SESSION_COOKIE_NAME: "vera_contract_session", DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5433/not_connected", MINIO_ROOT_USER: "synthetic", MINIO_ROOT_PASSWORD: "synthetic-only" });
    try {
      const { AppModule } = await import("../app.module");
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({}).compile();
      app = module.createNestApplication({ logger: false });
      configureApplication(app); configureSwagger(app);
      await app.listen(0, "127.0.0.1"); base = await app.getUrl();
      document = await (await fetch(base + "/api/docs-json")).json() as OpenAPIObject;
    } finally { original.restore(); }
  }, 30000);
  afterAll(async () => { await app?.close(); });
  it.each(huongContracts)("documents $method $path with actual success status", contract => {
    const op = document.paths[contract.path]?.[contract.method];
    expect(op?.summary).toBe(contract.summary);
    expect(op?.responses[contract.status]).toBeDefined();
    expect(op?.security).toEqual(contract.security ? [{ sessionCookie: [] }] : []);
    if (!contract.path.startsWith("/api/health")) expect(op?.responses[429]).toHaveProperty("headers.Retry-After");
    if (contract.status === 204) expect(op?.responses[204]).not.toHaveProperty("content");
    if (contract.body) expect((op?.requestBody as RequestBodyObject).content["application/json"].schema).toEqual(contract.body);
  });
  it("tracks the actual report enum and server validators", () => {
    const report = huongContracts.find(c => c.path === "/api/reports")!;
    expect((report.body!.properties!.reason as SchemaObject).enum).toEqual(Object.values(ReportReason));
    expect(uploadInput({ mimeType: "video/mp4", sizeBytes: 12 })).toEqual({ mimeType: "video/mp4", sizeBytes: 12 });
    expect(() => uploadInput({ mimeType: "video/mp4", sizeBytes: 104857601 })).toThrow();
    expect(() => closureInput({ confirmation: "CLOSE MY ACCOUNT", password: "synthetic", expectedRevision: 0 }, "12345678-1234-4234-8234-123456789abc")).not.toThrow();
  });
  it("publishes no cookie secret and does not turn docs into an auth bypass", async () => {
    expect(document.components?.securitySchemes?.sessionCookie).toMatchObject({ in: "cookie", name: "vera_contract_session" });
    expect(Object.values(document.paths).flatMap(path => Object.entries(path ?? {}).filter(([method]) => ["get", "post", "patch", "delete", "put"].includes(method)))).toHaveLength(60);
    expect(document.servers).toEqual([{ url: "/", description: "Same-origin API; operation paths already include /api" }]);
    expect((await fetch(base + "/api/auth/me")).status).toBe(401);
    expect((await fetch(base + "/api/videos/me")).status).toBe(401);
  });
});
