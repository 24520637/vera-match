import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { EnvironmentService } from "./config/environment.service";
import { configureApplication } from "./configure-app";
import { configureSwagger } from "./openapi/configure-swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const settings = app.get(EnvironmentService).values;
  app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
  configureApplication(app);
  configureSwagger(app);
  await app.listen(settings.apiPort);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
