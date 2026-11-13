import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "./database/prisma.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @ApiOperation({
    summary: "Minimal API process health (does not check database)",
  })
  health() {
    return { service: "vera-api", status: "ok", implementation: "scaffold" };
  }

  @Get("ready")
  @ApiOperation({
    summary: "Database readiness; 503 when PostgreSQL is unavailable",
  })
  ready() {
    return this.prisma.readiness();
  }
}
