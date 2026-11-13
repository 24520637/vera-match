import { Module } from '@nestjs/common';
import { EnvironmentModule } from './config/environment.module';
import { HealthController } from './health.controller';

@Module({ imports: [EnvironmentModule], controllers: [HealthController] })
export class AppModule {}
