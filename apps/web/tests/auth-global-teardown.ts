import { readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
export default async function teardown() {
  const root = resolve(__dirname, '../../..');
  const file = resolve(root, 'apps/web/.auth-e2e-runtime.json');
  let metadata: { kind: string; schema: string };
  try { metadata = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (metadata.kind !== 'vera-auth-e2e-v1' || !/^vera_auth_test_[a-f0-9]{32}$/.test(metadata.schema)) throw new Error('Unknown E2E runtime metadata; refusing cleanup');
  for (const env of ['apps/api/.env', '.env']) { try { process.loadEnvFile(resolve(root, env)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '5433') throw new Error('Local E2E database required');
  const client = new PrismaClient({ log: [] });
  try { await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${metadata.schema}" CASCADE`); }
  finally { await client.$disconnect(); }
  await unlink(file);
}
