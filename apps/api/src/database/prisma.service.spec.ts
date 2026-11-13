import { ServiceUnavailableException } from '@nestjs/common';
import { EnvironmentService } from '../config/environment.module';
import { parseEnvironment } from '../config/environment';
import { PrismaService } from './prisma.service';

describe('Prisma lifecycle', () => {
  let service: PrismaService;
  beforeEach(() => {
    const values = parseEnvironment({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5433/vera_test', MINIO_ROOT_USER: 'synthetic', MINIO_ROOT_PASSWORD: 'synthetic-test-only' });
    service = new PrismaService({ values } as EnvironmentService);
  });
  afterEach(async () => { jest.restoreAllMocks(); await service.$disconnect(); });
  it('connects once on initialization and disconnects on shutdown', async () => {
    const connect = jest.spyOn(service, '$connect').mockResolvedValue();
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue();
    await service.onModuleInit(); await service.onApplicationShutdown();
    expect(connect).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it('redacts startup database failures and cleans up', async () => {
    jest.spyOn(service, '$connect').mockRejectedValue(new Error('postgresql://secret:password@db'));
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue();
    await expect(service.onModuleInit()).rejects.toThrow('Database connection failed. Check database availability and configuration.');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it('reports readiness only after a real query succeeds', async () => {
    const query = jest.spyOn(service, '$queryRaw').mockResolvedValue([{ result: 1 }]);
    await expect(service.readiness()).resolves.toEqual({ service: 'vera-api', status: 'ready', database: 'ok' });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('returns a sanitized 503 when a running connection fails', async () => {
    jest.spyOn(service, '$queryRaw').mockRejectedValue(new Error('secret-connection-details'));
    await expect(service.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    try { await service.readiness(); } catch (error) { expect((error as ServiceUnavailableException).getResponse()).toEqual({ code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable. Try again later.' }); }
  });
});
