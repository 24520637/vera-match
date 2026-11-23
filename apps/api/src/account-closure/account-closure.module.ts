import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsentModule } from "../consent/consent.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { AccountClosureController } from "./account-closure.controller";
import { AccountClosureService } from "./account-closure.service";
import { ClosureStatusService } from "./closure-status.service";

@Module({ imports: [AuthModule, ConsentModule, DatabaseModule, EnvironmentModule], controllers: [AccountClosureController],
  providers: [AccountClosureService, ClosureStatusService], exports: [AccountClosureService] })
export class AccountClosureModule {}
