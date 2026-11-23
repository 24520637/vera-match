import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { AuthRequestGuard } from "../auth/auth-request.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { sessionCookieOptions } from "../auth/session-cookie";
import { EnvironmentService } from "../config/environment.service";
import { StaffMfaService } from "./staff-mfa.service";
@Controller("auth/staff-mfa")
export class StaffMfaController {
 constructor(private readonly mfa:StaffMfaService,private readonly environment:EnvironmentService){}
 private elevated<T extends {token:string,sessionId:string,expiresAt:Date}>(result:T,response:Response){
  response.cookie(this.environment.values.session.cookieName,result.token,{...sessionCookieOptions(this.environment.values),maxAge:Math.max(0,result.expiresAt.getTime()-Date.now())});
  const {token:_token,sessionId:_session,expiresAt:_expires,...publicResult}=result;return publicResult;
 }
 @Get() @UseGuards(SessionAuthGuard)
 status(@Req() request:AuthenticatedRequest){return this.mfa.status(request.auth!);}
 @Post("enrollment") @HttpCode(201) @UseGuards(AuthRequestGuard,SessionAuthGuard)
 enroll(@Req() request:AuthenticatedRequest,@Body() input:unknown){return this.mfa.enroll(request.auth!,input);}
 @Post("enrollment/confirm") @HttpCode(200) @UseGuards(AuthRequestGuard,SessionAuthGuard)
 async confirm(@Req() request:AuthenticatedRequest,@Body() input:unknown,@Res({passthrough:true}) response:Response){return this.elevated(await this.mfa.confirm(request.auth!,input),response);}
 @Post("verify") @HttpCode(200) @UseGuards(AuthRequestGuard,SessionAuthGuard)
 async verify(@Req() request:AuthenticatedRequest,@Body() input:unknown,@Res({passthrough:true}) response:Response){return this.elevated(await this.mfa.verify(request.auth!,input),response);}
 @Post("recover") @HttpCode(200) @UseGuards(AuthRequestGuard,SessionAuthGuard)
 async recover(@Req() request:AuthenticatedRequest,@Body() input:unknown,@Res({passthrough:true}) response:Response){return this.elevated(await this.mfa.recover(request.auth!,input),response);}
 @Post("recovery-codes") @HttpCode(200) @UseGuards(AuthRequestGuard,SessionAuthGuard)
 rotateCodes(@Req() request:AuthenticatedRequest,@Body() input:unknown){return this.mfa.rotateCodes(request.auth!,input);}
 @Post("devices/:deviceId/revoke") @HttpCode(204) @UseGuards(AuthRequestGuard,SessionAuthGuard)
 async revoke(@Req() request:AuthenticatedRequest,@Param("deviceId") id:string,@Body() input:unknown,@Res({passthrough:true}) response:Response){await this.mfa.revoke(request.auth!,id,input);response.clearCookie(this.environment.values.session.cookieName,sessionCookieOptions(this.environment.values,false));}
}
