import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { EnvironmentService } from "./config/environment.service";
import { configureApplication } from "./configure-app";
import { configureSwagger } from "./openapi/configure-swagger";
import { RecoveryJournalService } from "./recovery/recovery-journal.service";
import { ConsentService } from "./consent/consent.service";

async function bootstrap() {
  // Restore targets use an isolated service environment. Keep listeners and
  // background workers stopped while operator-side reconciliation is pending.
  if (process.env.RECOVERY_MODE !== undefined && process.env.RECOVERY_MODE !== "normal") {
    throw new Error("RECOVERY_FENCE_CLOSED");
  }
  const app = await NestFactory.create(AppModule);
  const settings = app.get(EnvironmentService).values;
  // ConfigModule may have loaded this setting from a host dotenv file after
  // the early process-environment check. Fence before any recovery/listener.
  if (process.env.RECOVERY_MODE !== undefined && process.env.RECOVERY_MODE !== "normal") {
    throw new Error("RECOVERY_FENCE_CLOSED");
  }
  await app.get(RecoveryJournalService).recoverBeforeListening(app.get(ConsentService));
  app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
  configureApplication(app);
  configureSwagger(app);
  await app.listen(settings.apiPort);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
