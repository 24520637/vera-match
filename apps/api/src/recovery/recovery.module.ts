import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { RecoveryFenceGuard, RecoveryJournalService } from "./recovery-journal.service";

@Global()
@Module({ imports: [DatabaseModule, EnvironmentModule], providers: [RecoveryJournalService,
  { provide: APP_GUARD, useClass: RecoveryFenceGuard }], exports: [RecoveryJournalService] })
export class RecoveryModule {}
