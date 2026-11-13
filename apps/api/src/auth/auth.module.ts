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
import { EmailService } from './email.service';
import { VerificationService } from './verification.service';
import { LoginService } from './login.service';
import { LogoutService } from './logout.service';

@Module({
  imports: [EnvironmentModule, DatabaseModule],
  controllers: [AuthController],
  providers: [PasswordService, SessionService, SessionAuthGuard, RolesGuard, RegistrationService, AuthRateLimiter, AuthRequestGuard, EmailService, VerificationService, LoginService, LogoutService],
  exports: [PasswordService, SessionService, SessionAuthGuard, RolesGuard],
})
export class AuthModule {}
