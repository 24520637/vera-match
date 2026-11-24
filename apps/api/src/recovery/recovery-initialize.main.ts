import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { EnvironmentModule } from "../config/environment.module";
import { EnvironmentService } from "../config/environment.service";
import { DatabaseModule } from "../database/database.module";
import { RecoveryModule } from "./recovery.module";
import { RecoveryJournalService } from "./recovery-journal.service";
import { staffDatabaseFingerprint } from "../staff-security/staff-provision.main";

@Module({ imports: [EnvironmentModule, DatabaseModule, RecoveryModule] })
class RecoveryInitializationModule {}
async function main(args: string[]) {
  if (args.length !== 3 || args[0] !== "--database-fingerprint" || !/^[a-f0-9]{64}$/.test(args[1]) || args[2] !== "--initialize")
    throw new Error("RECOVERY_OPERATOR_ARGUMENTS_INVALID");
  const app = await NestFactory.createApplicationContext(RecoveryInitializationModule, { logger: false, abortOnError: false });
  try {
    if (process.env.RECOVERY_MODE !== undefined && process.env.RECOVERY_MODE !== "normal") throw new Error("RECOVERY_FENCE_CLOSED");
    if (staffDatabaseFingerprint(app.get(EnvironmentService).values.databaseUrl) !== args[1]) throw new Error("RECOVERY_DATABASE_TARGET_MISMATCH");
    const result = await app.get(RecoveryJournalService).initializeDatabaseBinding();
    console.info(JSON.stringify({ code: "RECOVERY_DATABASE_BOUND", ...result }));
  } finally { await app.close(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  console.error("RECOVERY_INITIALIZATION_FAILED: verify target and journal state; never reinitialize a restored database to bypass the fence"); process.exitCode = 1;
});
