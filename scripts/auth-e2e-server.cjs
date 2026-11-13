const { resolve } = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = resolve(__dirname, '..');
process.env.NODE_ENV = 'test';
for (const file of ['apps/api/.env', '.env']) { try { process.loadEnvFile(resolve(root, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
Object.assign(process.env, { API_PORT: '4100', APP_BASE_URL: 'http://localhost:3100', CORS_ORIGIN: 'http://localhost:3100', COOKIE_SECURE: 'false', COOKIE_SAME_SITE: 'lax', SESSION_COOKIE_NAME: 'vera_e2e_session' });
process.env.MINIO_ROOT_USER ||= 'synthetic-e2e'; process.env.MINIO_ROOT_PASSWORD ||= 'synthetic-e2e-only';
const { PrismaClient } = require('@prisma/client');
const admin = new PrismaClient({ log: [] });
const schema = `vera_auth_test_${randomUUID().replaceAll('-', '')}`;
const metadata = resolve(root, 'apps/web/.auth-e2e-runtime.json');
let app;
async function cleanup() {
  await app?.close();
  if (!/^vera_auth_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe fixture cleanup');
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
  if (fs.existsSync(metadata) && JSON.parse(fs.readFileSync(metadata, 'utf8')).schema === schema) fs.unlinkSync(metadata);
}
(async () => {
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '5433') throw new Error('Local PostgreSQL test database required');
  if (fs.existsSync(metadata)) throw new Error('Previous auth test runtime metadata requires inspection');
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.toString();
  execFileSync(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(root, 'apps/api/prisma/schema.prisma')], { env: process.env, stdio: 'pipe', windowsHide: true });
  fs.writeFileSync(metadata, JSON.stringify({ kind: 'vera-auth-e2e-v1', schema }), { flag: 'wx' });
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(resolve(root, 'apps/api/dist/app.module.js'));
  const { configureApplication } = require(resolve(root, 'apps/api/dist/configure-app.js'));
  app = await NestFactory.create(AppModule, { logger: false }); configureApplication(app); await app.listen(4100, '127.0.0.1');
  console.log('Authentication E2E API ready on localhost:4100');
})().catch(async () => { console.error('Authentication E2E setup failed; check local PostgreSQL/Mailpit and test runtime metadata.'); await cleanup().catch(() => undefined); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(0)); });
