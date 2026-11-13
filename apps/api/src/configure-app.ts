import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { EnvironmentService } from "./config/environment.service";
import { createValidationPipe } from "./auth/auth-validation";

export function configureApplication(app: INestApplication) {
  app.setGlobalPrefix("api");
  app.useGlobalPipes(createValidationPipe());
  app.enableCors({
    origin: app.get(EnvironmentService).values.corsOrigin,
    credentials: true,
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith("/api/auth")) {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.vary("Cookie");
    }
    next();
  });
}
