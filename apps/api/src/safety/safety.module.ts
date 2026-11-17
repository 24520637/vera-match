import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { BlockController } from "./block.controller";
import { BlockService } from "./block.service";
import { BlockAccessService } from "./block-access.service";
import { SafetyAccessService } from "./safety-access.service";
import { SafetyRateLimiter, SafetyRequestGuard } from "./safety-request.guard";
@Module({
  imports: [AuthModule, DatabaseModule, EnvironmentModule],
  controllers: [BlockController],
  providers: [
    BlockService,
    BlockAccessService,
    SafetyAccessService,
    SafetyRateLimiter,
    SafetyRequestGuard,
  ],
  exports: [BlockAccessService],
})
export class SafetyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((_r: Request, s: Response, n: NextFunction) => {
        s.setHeader("Cache-Control", "private, no-store");
        s.setHeader("Referrer-Policy", "no-referrer");
        s.vary("Cookie");
        n();
      })
      .forRoutes(BlockController);
  }
}
