import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "./database/prisma.service";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: "Discover the API and its health endpoints",
    description: "Public API entry point. Returns relative URLs for process liveness and PostgreSQL readiness.",
  })
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["service", "health", "readiness"],
      properties: {
        service: { type: "string", enum: ["vera-api"] },
        health: { type: "string", example: "/api/health" },
        readiness: { type: "string", example: "/api/health/ready" },
      },
    },
  })
  discover() {
    return { service: "vera-api", health: "/api/health", readiness: "/api/health/ready" };
  }

  @Get("health")
  @ApiOperation({
    summary: "Minimal API process health (does not check database)",
  })
  health() {
    return { service: "vera-api", status: "ok", implementation: "scaffold" };
  }

  @Get("health/ready")
  @ApiOperation({
    summary: "Database readiness; 503 when PostgreSQL is unavailable",
  })
  ready() {
    return this.prisma.readiness();
  }
}
