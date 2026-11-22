import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { ProfileModule } from "../profile/profile.module";
import { ConsentPolicyRegistry } from "./consent.policy";
import { ConsentService } from "./consent.service";
import { ConsentAccessService } from "./consent-access.service";
import { ConsentController } from "./consent.controller";
import { ConsentRequestGuard, ConsentWithdrawalLimiter } from "./consent-request.guard";

@Module({ imports: [AuthModule, DatabaseModule, EnvironmentModule, ProfileModule], controllers: [ConsentController],
  providers: [ConsentPolicyRegistry, ConsentService, ConsentAccessService, ConsentRequestGuard, ConsentWithdrawalLimiter],
  exports: [ConsentAccessService, ConsentService],
})
export class ConsentModule {}
