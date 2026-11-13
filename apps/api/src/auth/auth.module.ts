import { Module } from "@nestjs/common";
import { EnvironmentModule } from "../config/environment.module";
import { PasswordService } from "./password.service";
import { DatabaseModule } from "../database/database.module";
import { SessionService } from "./session.service";
import { SessionAuthGuard } from "./session-auth.guard";
import { RolesGuard } from "./roles.guard";
import { RegistrationService } from './registration.service';
import { AuthController } from './auth.controller';
import { AuthRateLimiter, AuthRequestGuard } from './auth-request.guard';

@Module({
  imports: [EnvironmentModule, DatabaseModule],
  controllers: [AuthController],
  providers: [PasswordService, SessionService, SessionAuthGuard, RolesGuard, RegistrationService, AuthRateLimiter, AuthRequestGuard],
  exports: [PasswordService, SessionService, SessionAuthGuard, RolesGuard],
})
export class AuthModule {}
