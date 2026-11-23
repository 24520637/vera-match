import { EnvironmentService } from "../config/environment.service";
import { sessionCookieOptions } from "../auth/session-cookie";
import { Body, Controller, Get, Header, Headers, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { AuthRateLimiter, AuthRequestGuard } from "../auth/auth-request.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AccountClosureService } from "./account-closure.service";
import { ClosureStatusService } from "./closure-status.service";
import { digest } from "./closure.validation";

@Controller("account-closure")
export class AccountClosureController {
  constructor(private readonly closure: AccountClosureService, private readonly status: ClosureStatusService,
    private readonly limiter: AuthRateLimiter, private readonly environment: EnvironmentService) {}
  @Get("availability") @UseGuards(SessionAuthGuard) @Header("Cache-Control", "private, no-store")
  availability() { return this.closure.availability(); }
  @Post() @HttpCode(202) @UseGuards(SessionAuthGuard, AuthRequestGuard)
  async close(@Req() req: AuthenticatedRequest, @Body() body: unknown, @Headers("idempotency-key") key: unknown, @Res({ passthrough: true }) response: Response) {
    this.limiter.consume("closure:member", req.auth!.user.id, 5);
    const receipt = await this.closure.request(req.auth!, body, key);
    response.clearCookie(this.environment.values.session.cookieName, sessionCookieOptions(this.environment.values, false));
    this.status.afterClosure(req.auth!.user.id);
    return receipt;
  }
  @Post("status-email") @HttpCode(202) @UseGuards(AuthRequestGuard)
  requestStatusEmail(@Req() req: Request, @Body() body: unknown) {
    this.limiter.consume("closure-status-email:ip", req.ip ?? "unknown", 10);
    return this.status.request(body);
  }
  @Post("status") @HttpCode(200) @UseGuards(AuthRequestGuard)
  consumeStatus(@Req() req: Request, @Body() body: unknown) {
    this.limiter.consume("closure-status:ip", req.ip ?? "unknown", 20);
    const token = body && typeof body === "object" && typeof (body as {token?:unknown}).token === "string"
      ? (body as {token:string}).token.slice(0, 128) : "invalid";
    this.limiter.consume("closure-status:token", digest(token), 5);
    return this.status.consume(body);
  }
}
