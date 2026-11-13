import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { EnvironmentService } from "./config/environment.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const settings = app.get(EnvironmentService).values;
  app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({ origin: settings.corsOrigin, credentials: true });
  const config = new DocumentBuilder()
    .setTitle("VERA Match API — scaffold")
    .setVersion("0.1.0")
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    SwaggerModule.createDocument(app, config),
  );
  await app.listen(settings.apiPort);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
