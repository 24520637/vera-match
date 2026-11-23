import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { EnvironmentService } from "../config/environment.service";

export const sessionCookieScheme = "sessionCookie";

export function configureSwagger(app: INestApplication) {
  const settings = app.get(EnvironmentService).values;
  if (settings.nodeEnv === "production") return;

  const config = new DocumentBuilder()
    .setTitle("VERA Match API — scaffold")
    .setVersion("0.1.0")
    .addCookieAuth(settings.session.cookieName, { type: "apiKey" }, sessionCookieScheme)
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, config));
}
