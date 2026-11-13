import { Module } from '@nestjs/common';
import { EnvironmentModule } from './config/environment.module';
import { HealthController } from './health.controller';
import { DatabaseModule } from './database/database.module';

@Module({ imports: [EnvironmentModule, DatabaseModule], controllers: [HealthController] })
export class AppModule {}
