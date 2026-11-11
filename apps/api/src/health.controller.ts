import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Minimal API process health (does not check database)' })
  health() { return { service: 'vera-api', status: 'ok', implementation: 'scaffold' }; }
}
