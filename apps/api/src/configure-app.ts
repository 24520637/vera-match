import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { EnvironmentService } from "./config/environment.service";
import { createValidationPipe } from "./auth/auth-validation";
import { AuthRateLimitFilter } from "./auth/auth-rate-limit.exception";

export function configureApplication(app: INestApplication) {
  app.setGlobalPrefix("api");
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AuthRateLimitFilter());
  app.enableCors({
    origin: app.get(EnvironmentService).values.corsOrigin,
    credentials: true,
    exposedHeaders: ["Retry-After"],
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    // Before body parsing: malformed JSON denials must also remain private.
    const path = request.path.toLowerCase();
    if (["/api/expert/assignments", "/api/expert/reviews", "/api/qa/reviews"]
      .some(prefix => path === prefix || path.startsWith(prefix + "/"))) {
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.vary("Cookie");
    }
    if (request.path.startsWith("/api/auth")) {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.vary("Cookie");
    }
    next();
  });
}
