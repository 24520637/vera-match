import { Module } from "@nestjs/common";
import { EnvironmentModule } from "../config/environment.module";
import { PasswordService } from "./password.service";
import { DatabaseModule } from "../database/database.module";
import { SessionService } from "./session.service";
import { SessionAuthGuard } from "./session-auth.guard";
import { RolesGuard } from "./roles.guard";

@Module({
  imports: [EnvironmentModule, DatabaseModule],
  providers: [PasswordService, SessionService, SessionAuthGuard, RolesGuard],
  exports: [PasswordService, SessionService, SessionAuthGuard, RolesGuard],
})
export class AuthModule {}
