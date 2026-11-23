import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { EnvironmentService } from "../config/environment.service";
import { addHuongContracts } from "./huong-contracts";

export const sessionCookieScheme = "sessionCookie";

export function documentationMode(nodeEnv: string, env: Record<string, string | undefined>) {
  const mode = env.API_DOCS_MODE ?? (nodeEnv === "production" ? "disabled" : "public");
  if (mode !== "disabled" && mode !== "public") throw new Error("API_DOCS_MODE must be disabled or public");
  return mode;
}

export function configureSwagger(app: INestApplication) {
  const settings = app.get(EnvironmentService).values;
  if (documentationMode(settings.nodeEnv, process.env) === "disabled") return;
  const config = new DocumentBuilder()
    .setTitle("VERA Match API")
    .setDescription("Cookie-session API. Public documentation does not grant access to protected resources. Production assurance, consent and lifecycle release gates still apply. Never paste real credentials or private media URLs into shared documentation tools.")
    .setVersion("0.1.0")
    .addServer("/", "Same-origin API; operation paths already include /api")
    .addCookieAuth(settings.session.cookieName, { type: "apiKey" }, sessionCookieScheme)
    .build();
  const document = addHuongContracts(SwaggerModule.createDocument(app, config));
  SwaggerModule.setup("api/docs", app, document, {
    swaggerOptions: {
      persistAuthorization: false,
      ...(settings.nodeEnv === "production" ? { supportedSubmitMethods: [] } : {}),
    },
  });
}
