import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/** A fresh schema holds only synthetic data. Never migrates or resets the configured public schema. */
export async function createAuthDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '5433') throw new Error('Local PostgreSQL test database required');
  const schema = `vera_auth_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new PrismaClient({ log: [] });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('schema', schema);
  try {
    execFileSync(process.execPath, [resolve(__dirname, '../../../node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(__dirname, '../prisma/schema.prisma')], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe', windowsHide: true, timeout: 30000 });
  } catch { await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await admin.$disconnect(); throw new Error('Unable to prepare isolated authentication test schema'); }
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  return { client, url: url.toString(), schema, async close() {
    await client.$disconnect();
    if (!/^vera_auth_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test cleanup');
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await admin.$disconnect();
  } };
}
