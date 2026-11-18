import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth-context";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { SafetyRequestGuard } from "./safety-request.guard";
import { BlockService } from "./block.service";
@Controller("blocks")
@UseGuards(SessionAuthGuard, RolesGuard, SafetyRequestGuard)
@Roles("MEMBER")
export class BlockController {
  constructor(private readonly blocks: BlockService) {}
  @Get("me") listBlocks(@Req() r: AuthenticatedRequest, @Query() q: unknown) {
    return this.blocks.list(r.auth!, q);
  }
  @Post() @HttpCode(204) block(
    @Req() r: AuthenticatedRequest,
    @Body() b: unknown,
  ) {
    return this.blocks.block(r.auth!, b);
  }
  @Delete(":targetUserId") @HttpCode(204) unblock(
    @Req() r: AuthenticatedRequest,
    @Param("targetUserId") id: string,
    @Body() b: unknown,
  ) {
    return this.blocks.unblock(r.auth!, id, b);
  }
}
