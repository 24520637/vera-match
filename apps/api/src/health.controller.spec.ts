import { HealthController } from './health.controller';
import { PrismaService } from './database/prisma.service';
describe('HealthController', () => {
  it('reports scaffold process health', () => {
    // Liveness must not touch the database, even when readiness is unavailable.
    const prisma = { readiness: jest.fn() };
    expect(new HealthController(prisma as unknown as PrismaService).health()).toEqual({ service: 'vera-api', status: 'ok', implementation: 'scaffold' });
    expect(prisma.readiness).not.toHaveBeenCalled();
  });
});
