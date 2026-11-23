import { ApiOperation, ApiQuery, ApiResponse, ApiSecurity } from "@nestjs/swagger";
import { Body, Controller, Get, Header, Patch, Req, Res, UseGuards } from "@nestjs/common";
import { ConsentPurpose, UserRole } from "@prisma/client";
import type { Request, Response } from "express";
import type { CurrentUser as SafeUser } from "../auth/auth-context";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { invalidRequest } from "../profile/profile.validation";
import { ConsentRequestGuard } from "./consent-request.guard";
import { ConsentService } from "./consent.service";

@Controller("consents")
@UseGuards(SessionAuthGuard, RolesGuard, ConsentRequestGuard)
@Roles(UserRole.MEMBER)
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}
  private query(request: Request) {
    if (Object.keys(request.query).length) invalidRequest([{ field: "_form", messages: ["Query parameters are not supported."] }]);
  }
  @Get("policies")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @ApiSecurity("sessionCookie")
  @ApiOperation({ summary: "Read approved consent notices in the selected language", description: "Active verified MEMBER session required. Returns only signed, currently approved published snapshots; an empty list means grants remain unavailable. Does not grant or withdraw consent. No testOnly policy is published through this endpoint." })
  @ApiQuery({ name: "locale", required: false, enum: ["en", "vi"] })
  @ApiResponse({ status: 200, schema: { type: "object", required: ["locale", "policies"], properties: { locale: { type: "string", enum: ["en", "vi"] }, policies: { type: "array", items: { type: "object", required: ["purpose", "policyVersion", "locale", "content", "digest", "optional", "dependencies"], properties: { purpose: { type: "string", enum: Object.values(ConsentPurpose) }, policyVersion: { type: "string" }, locale: { type: "string", enum: ["en", "vi"] }, content: { type: "string" }, digest: { type: "string", pattern: "^[a-f0-9]{64}$" }, optional: { type: "boolean", enum: [true] }, dependencies: { type: "array", items: { type: "string" } } } } } } } })
  published(@Req() request: Request) {
    if (Object.keys(request.query).some(key => key !== "locale")) invalidRequest([{ field: "_form", messages: ["Only locale is supported."] }]);
    return this.consents.published(request.query.locale ?? "en");
  }
  @Get("me")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  get(@CurrentUser() user: SafeUser, @Req() request: Request) {
    this.query(request); return this.consents.get(user.id);
  }
  @Patch("me")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  async patch(@CurrentUser() user: SafeUser, @Body() input: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.query(request);
    const result = await this.consents.patch(user.id, input, request.headers["idempotency-key"]);
    response.setHeader("Access-Control-Expose-Headers", "Retry-After, Idempotency-Replayed");
    if (result.replayed) response.setHeader("Idempotency-Replayed", "true");
    return result.response;
  }
}
