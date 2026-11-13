import { Injectable, OnApplicationShutdown, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EnvironmentService } from '../config/environment.module';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor(environment: EnvironmentService) {
    const url = new URL(environment.values.databaseUrl);
    // Bound initial connection/pool waits without overriding explicit deployment settings.
    if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '3');
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '3');
    super({ datasources: { db: { url: url.toString() } }, log: [] });
  }

  async onModuleInit() {
    try { await this.$connect(); }
    catch { await this.$disconnect().catch(() => undefined); throw new Error('Database connection failed. Check database availability and configuration.'); }
  }

  async onApplicationShutdown() { await this.$disconnect(); }

  async readiness() {
    try { await this.$queryRaw`SELECT 1`; return { service: 'vera-api', status: 'ready', database: 'ok' }; }
    catch { throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable. Try again later.' }); }
  }
}
