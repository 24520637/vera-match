import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { EnvironmentService } from '../src/config/environment.service';
import { parseEnvironment } from '../src/config/environment';
import { configureApplication } from '../src/configure-app';
import { hashVerificationToken } from '../src/auth/verification.service';
import { createAuthDatabase } from './disposable-auth-database';
import { clearTestEmails, readActivationEmail } from './mailpit-fixtures';

describe('email authentication HTTP / PostgreSQL / native SMTP', () => {
  let database: Awaited<ReturnType<typeof createAuthDatabase>>;
  let app: INestApplication; let base: string; let origin: string;
  const recipients: string[] = [];
  beforeAll(async () => {
    database = await createAuthDatabase();
    const values = parseEnvironment({ ...process.env, DATABASE_URL: database.url }); origin = values.corsOrigin;
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EnvironmentService).useValue({ values }).compile();
    app = module.createNestApplication({ logger: false }); configureApplication(app); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  }, 60000);
  afterAll(async () => {
    try { for (const email of recipients) await clearTestEmails(email); }
    finally { await app?.close(); await database?.close(); }
  });
  const newEmail = () => { const email = `auth-${randomUUID()}@example.invalid`; recipients.push(email); return email; };
  const post = (path: string, body: object, requestOrigin?: string, cookie?: string) => fetch(`${base}/api/auth/${path}`, { method: 'POST', headers: { Origin: requestOrigin ?? origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });

  it('validates registration, persists a pending hash, sends a real email and does not overwrite duplicates', async () => {
    const email = newEmail(); const valid = { email: email.toUpperCase(), password: 'synthetic-register-password', declaredAdult: true };
    expect((await post('register', { ...valid, declaredAdult: false })).status).toBe(400);
    expect((await post('register', valid, 'https://attacker.invalid')).status).toBe(403);
    const before = Date.now(); const response = await post('register', valid);
    expect(response.status).toBe(202); expect(response.headers.get('set-cookie')).toBeNull(); expect(response.headers.get('cache-control')).toBe('no-store');
    const firstBody = await response.json();
    const user = await database.client.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ status: 'PENDING_EMAIL', emailVerifiedAt: null, declaredAdult: true, role: 'MEMBER' });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/); expect(user.passwordHash).not.toBe(valid.password);
    const activation = await readActivationEmail(email);
    const row = await database.client.emailVerificationToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.tokenHash).toBe(hashVerificationToken(activation.token)); expect(row.tokenHash).not.toBe(activation.token);
    expect(row.expiresAt.getTime()).toBeGreaterThan(before + 59000); expect(new URL(activation.link).search).toBe('');
    const duplicate = await post('register', { ...valid, password: 'another-synthetic-password' });
    expect(duplicate.status).toBe(202); expect(await duplicate.json()).toEqual(firstBody);
    expect((await database.client.user.findUniqueOrThrow({ where: { email } })).passwordHash).toBe(user.passwordHash);
    expect(await database.client.user.count({ where: { email } })).toBe(1);
    expect(await database.client.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('consumes activation once under concurrent verification, without creating a session', async () => {
    const email = newEmail();
    expect((await post('register', { email, password: 'synthetic-password-123', declaredAdult: true })).status).toBe(202);
    const activation = await readActivationEmail(email);
    const responses = await Promise.all([post('verify-email', { token: activation.token }), post('verify-email', { token: activation.token })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
    const user = await database.client.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe('ACTIVE'); expect(user.emailVerifiedAt).not.toBeNull();
    expect(await database.client.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await post('verify-email', { token: activation.token })).status).toBe(400);
  });

  it('rejects unknown, expired and suspended activation without activating the account', async () => {
    expect((await post('verify-email', { token: 'a'.repeat(43) })).status).toBe(400);
    const email = newEmail();
    await post('register', { email, password: 'synthetic-password-123', declaredAdult: true });
    const activation = await readActivationEmail(email);
    await database.client.emailVerificationToken.update({ where: { tokenHash: hashVerificationToken(activation.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post('verify-email', { token: activation.token })).status).toBe(400);
    expect((await database.client.user.findUniqueOrThrow({ where: { email } })).status).toBe('PENDING_EMAIL');
    await database.client.emailVerificationToken.update({ where: { tokenHash: hashVerificationToken(activation.token) }, data: { expiresAt: new Date(Date.now() + 60000) } });
    await database.client.user.update({ where: { email }, data: { status: 'SUSPENDED' } });
    expect((await post('verify-email', { token: activation.token })).status).toBe(400);
    expect((await database.client.emailVerificationToken.findUniqueOrThrow({ where: { tokenHash: hashVerificationToken(activation.token) } })).consumedAt).toBeNull();
  });
});
