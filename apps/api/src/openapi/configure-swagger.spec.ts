import type { OpenAPIObject } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { parseEnvironment } from "../config/environment";
import { EnvironmentService } from "../config/environment.service";
import { configureApplication } from "../configure-app";
import { PrismaService } from "../database/prisma.service";
import { HealthController } from "../health.controller";
import { configureSwagger, documentationMode } from "./configure-swagger";

const swaggerPaths = [
  "/api/docs",
  "/api/docs/",
  "/api/docs-json",
  "/api/docs-yaml",
  ...["/api/docs", "/api/docs/docs"].flatMap(prefix =>
    ["swagger-ui-init.js", "swagger-ui-bundle.js", "swagger-ui.css", "favicon-32x32.png", "oauth2-redirect.html"]
      .map(asset => prefix + "/" + asset),
  ),
];

describe("Swagger exposure", () => {
  it("rejects an unrecognized exposure mode", () => { expect(() => documentationMode("production", { API_DOCS_MODE: "true" })).toThrow("API_DOCS_MODE"); });
  it.each([
    ["development", undefined, 200],
    ["production", undefined, 404],
    ["production", "public", 200],
    ["test", "disabled", 404],
  ] as const)("serves Swagger paths with HTTP %s mode status %i", async (nodeEnv, mode, expectedStatus) => {
    const exposure = jest.replaceProperty(process, "env", { ...process.env, API_DOCS_MODE: mode });
    const settings = parseEnvironment({
      NODE_ENV: nodeEnv,
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5433/not_connected",
      APP_BASE_URL: "https://vera.test",
      CORS_ORIGIN: "https://vera.test",
      SMTP_HOST: "mail.vera.test",
      SMTP_FROM: "VERA Match <mail@vera.test>",
      SMTP_USER: "synthetic-user",
      SMTP_PASSWORD: "synthetic-mail-only",
      MINIO_ENDPOINT: "https://media.vera.test",
      MINIO_ROOT_USER: "synthetic-user",
      MINIO_ROOT_PASSWORD: "synthetic-media-only",
    });
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: EnvironmentService, useValue: { values: settings } },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    const app = module.createNestApplication({ logger: false });
    try {
      configureApplication(app);
      configureSwagger(app);
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      const results = await Promise.all(swaggerPaths.flatMap(path =>
        ["GET", "HEAD"].map(async method => {
          const response = await fetch(base + path, { method, redirect: "manual" });
          await response.body?.cancel();
          return [method, path, response.status];
        }),
      ));
      expect(results).toEqual(swaggerPaths.flatMap(path =>
        ["GET", "HEAD"].map(method => [method, path, expectedStatus]),
      ));
      const root = await fetch(base + "/api");
      expect(root.status).toBe(200);
      expect(await root.json()).toEqual({
        service: "vera-api",
        health: "/api/health",
        readiness: "/api/health/ready",
      });
      if (nodeEnv === "production" && mode === "public") {
        const spec = await (await fetch(base + "/api/docs-json")).json() as OpenAPIObject;
        expect(spec.paths["/api"]?.get?.responses["200"]).toBeDefined();
        const init = await (await fetch(base + "/api/docs/swagger-ui-init.js")).text();
        expect(init).toMatch(/"persistAuthorization":\s*false/);
        expect(init).toMatch(/"supportedSubmitMethods":\s*\[\]/);
      }
      const health = await fetch(base + "/api/health");
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ status: "ok" });
    } finally {
      await app.close();
      exposure.restore();
    }
  });
});
