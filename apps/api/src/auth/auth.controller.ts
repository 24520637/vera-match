import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthRequestGuard } from "./auth-request.guard";
import { RegistrationDto } from "./registration.dto";
import { RegistrationService } from "./registration.service";
import { VerificationService } from "./verification.service";
import { VerificationDto } from "./verification.dto";
import { EmailDto } from "./email.dto";
import { LoginDto } from "./login.dto";
import { LoginService } from "./login.service";
import { EnvironmentService } from "../config/environment.service";
import { sessionCookieOptions } from "./session-cookie";
import { SessionAuthGuard } from "./session-auth.guard";
import { CurrentUser } from "./current-user.decorator";
import type { CurrentUser as SafeUser } from "./auth-context";
import { LogoutService } from "./logout.service";

export const REGISTRATION_RESPONSE = {
  message:
    "Registration request received. If this address is eligible, activate your account before signing in.",
};

@Controller("auth")
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly verification: VerificationService,
    private readonly loginService: LoginService,
    private readonly environment: EnvironmentService,
    private readonly logoutService: LogoutService,
  ) {}
  @Post("logout")
  @HttpCode(204)
  @UseGuards(AuthRequestGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.logoutService.current(request.headers.cookie);
    response.clearCookie(
      this.environment.values.session.cookieName,
      sessionCookieOptions(this.environment.values, false),
    );
  }
  @Post("logout-all")
  @HttpCode(204)
  @UseGuards(AuthRequestGuard, SessionAuthGuard)
  async logoutAll(
    @CurrentUser() user: SafeUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.logoutService.all(user.id);
    response.clearCookie(
      this.environment.values.session.cookieName,
      sessionCookieOptions(this.environment.values, false),
    );
  }
  @Get("me")
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: SafeUser) {
    return user;
  }
  @Post("login")
  @HttpCode(200)
  @UseGuards(AuthRequestGuard)
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.loginService.login(input);
    response.cookie(
      this.environment.values.session.cookieName,
      result.token,
      sessionCookieOptions(this.environment.values),
    );
    return result.user;
  }
  @Post("verify-email")
  @HttpCode(200)
  @UseGuards(AuthRequestGuard)
  verify(@Body() input: VerificationDto) {
    return this.verification.verify(input.token);
  }
  @Post("resend-verification")
  @HttpCode(202)
  @UseGuards(AuthRequestGuard)
  resend(@Body() input: EmailDto) {
    return this.verification.resend(input.email);
  }
  @Post("register")
  @HttpCode(202)
  @UseGuards(AuthRequestGuard)
  async register(@Body() input: RegistrationDto) {
    const result = await this.registration.register(input);
    if (result.created && result.userId)
      await this.verification.issue(result.userId);
    return REGISTRATION_RESPONSE;
  }
}
