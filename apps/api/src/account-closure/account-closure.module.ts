import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsentModule } from "../consent/consent.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { AccountClosureController } from "./account-closure.controller";
import { AccountClosureService } from "./account-closure.service";
import { ClosureStatusService } from "./closure-status.service";
import { ClosureMediaService } from "./closure-media.service";
import { ClosurePolicyRegistry } from "./closure-policy";
import { ClosureReconciliationService } from "./closure-reconciliation.service";
import { RecoveryModule } from "../recovery/recovery.module";

@Module({ imports: [RecoveryModule, AuthModule, ConsentModule, DatabaseModule, EnvironmentModule], controllers: [AccountClosureController],
  providers: [AccountClosureService, ClosureStatusService, ClosureMediaService, ClosurePolicyRegistry, ClosureReconciliationService], exports: [AccountClosureService, ClosureMediaService] })
export class AccountClosureModule {}
