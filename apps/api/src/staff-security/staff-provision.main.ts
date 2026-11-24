import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { EnvironmentModule } from "../config/environment.module";
import { EnvironmentService } from "../config/environment.service";
import { DatabaseModule } from "../database/database.module";
import { StaffAuthority } from "./staff-authority";
import { StaffIdentityService } from "./staff-identity.service";
import { RecoveryModule } from "../recovery/recovery.module";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { ConsentModule } from "../consent/consent.module";
import { ConsentService } from "../consent/consent.service";

@Module({imports:[EnvironmentModule,DatabaseModule,RecoveryModule,ConsentModule],providers:[StaffAuthority,StaffIdentityService]})
class StaffProvisioningModule {}
export function staffDatabaseFingerprint(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return createHash("sha256").update(JSON.stringify([url.protocol,url.hostname,url.port,url.pathname,url.searchParams.get("schema") ?? "public"])).digest("hex");
}
export async function runStaffProvisioning(args: string[]) {
  // Deliberately no public self-provisioning endpoint or general AppModule workers.
  if (args.length !== 5 || args[0] !== "--directive" || args[2] !== "--database-fingerprint" || args[4] !== "--apply" || !isAbsolute(args[1]) || !/^[a-f0-9]{64}$/.test(args[3])) throw new Error("STAFF_OPERATOR_ARGUMENTS_INVALID");
  if (statSync(args[1]).size > 8192) throw new Error("STAFF_DIRECTIVE_INVALID");
  const serialized = readFileSync(args[1],"utf8");
  const app = await NestFactory.createApplicationContext(StaffProvisioningModule,{logger:false,abortOnError:false});
  try {
    if (staffDatabaseFingerprint(app.get(EnvironmentService).values.databaseUrl) !== args[3]) throw new Error("STAFF_DATABASE_TARGET_MISMATCH");
    await app.get(RecoveryJournalService).recoverBeforeListening(app.get(ConsentService));
    const result = await app.get(StaffIdentityService).apply(serialized);
    console.info(JSON.stringify({code:"STAFF_DIRECTIVE_APPLIED",...result}));
  } finally { await app.close(); }
}
if (require.main === module) runStaffProvisioning(process.argv.slice(2)).catch(() => {console.error(JSON.stringify({code:"STAFF_PROVISIONING_FAILED",message:"No success is asserted. Verify authority, target, directive revision and database availability."}));process.exitCode=1;});
