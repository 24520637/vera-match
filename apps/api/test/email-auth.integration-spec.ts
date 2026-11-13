import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { EnvironmentService } from '../src/config/environment.service';
import { SessionService } from '../src/auth/session.service';
import { configureApplication } from '../src/configure-app';
import { withAuthFixtures } from './auth-fixtures';

describe('email authentication HTTP / PostgreSQL', () => {
  let client: PrismaClient;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '5433') throw new Error('Local test database required');
    client = new PrismaClient({ log: [] }); await client.$connect();
  });
  afterAll(async () => { await client?.$disconnect(); });

  it('validates registration, persists pending hash only and handles duplicates without overwriting', async () => {
    const email = `register-${randomUUID()}@example.invalid`;
    await withAuthFixtures(client, async fixture => {
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(fixture.tx).compile();
      const app = module.createNestApplication({ logger: false }); configureApplication(app);
      try {
        await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
        const origin = app.get(EnvironmentService).values.corsOrigin;
        const post = (body: object, requestOrigin = origin) => fetch(`${base}/api/auth/register`, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const valid = { email: email.toUpperCase(), password: 'synthetic-register-password', declaredAdult: true };
        expect((await post({ ...valid, declaredAdult: false })).status).toBe(400);
        expect((await post(valid, 'https://attacker.invalid')).status).toBe(403);
        const response = await post(valid); expect(response.status).toBe(202); expect(response.headers.get('set-cookie')).toBeNull();
        const firstBody = await response.json();
        const user = await fixture.tx.user.findUniqueOrThrow({ where: { email } });
        expect(user).toMatchObject({ status: 'PENDING_EMAIL', emailVerifiedAt: null, declaredAdult: true, role: 'MEMBER' });
        expect(user.passwordHash).toMatch(/^\$argon2id\$/); expect(user.passwordHash).not.toBe(valid.password);
        const duplicate = await post({ ...valid, password: 'another-synthetic-password' }); expect(duplicate.status).toBe(202); expect(await duplicate.json()).toEqual(firstBody);
        expect((await fixture.tx.user.findUniqueOrThrow({ where: { email } })).passwordHash).toBe(user.passwordHash);
        expect(await fixture.tx.user.count({ where: { email } })).toBe(1);
        expect(await app.get(SessionService).resolve(fixture.token)).toBeNull();
      } finally { await app.close(); }
    });
    expect(await client.user.count({ where: { email } })).toBe(0);
  });
});
