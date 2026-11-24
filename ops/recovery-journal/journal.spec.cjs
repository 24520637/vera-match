'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync, randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { initialize, JournalStore, createServer, acquireWriterLock } = require('./server.cjs');
const { JournalClient, verifyCheckpoint, verifyEntries, genesis } = require('./protocol.cjs');
const { prepare } = require('./setup.cjs');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-journal-test-'));
  const file = path.join(temp, 'journal.jsonl'), journalId = randomUUID(), token = randomBytes(32).toString('base64url');
  const pair = generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  initialize(file, journalId);
  const config = { file, journalId, privateKey };
  const store = new JournalStore(config);
  const server = createServer(store, token);
  t.after(async () => { if (server.listening) { server.closeAllConnections(); await new Promise(r => server.close(r)); } store.close();
    assert.equal(path.dirname(temp), fs.realpathSync(os.tmpdir())); fs.rmSync(temp, { recursive: true, force: true }); });
  return { ...config, store, server, publicKey, token };
}
const intent = () => ({ id: randomUUID(), reason: 'CONSENT_WITHDRAWAL', userIds: ['synthetic-user'] });
test('configuration preparation separates signing material, refuses overwrite and rejects placeholder origins', t => {
  const f = fixture(t), output = path.join(path.dirname(f.file), 'generated-config');
  prepare(output, 'https://journal.example.com');
  const client = fs.readFileSync(path.join(output, 'client/client.json'), 'utf8');
  assert.ok(!client.includes('PRIVATE KEY'));
  assert.ok(!fs.existsSync(path.join(output, 'client/signing-private.pem')));
  assert.equal(fs.readFileSync(path.join(output, 'client/api-token'), 'utf8'), fs.readFileSync(path.join(output, 'server/api-token'), 'utf8'));
  assert.throws(() => prepare(output, 'https://journal.example.com'));
  assert.throws(() => prepare(output + '-invalid', 'http://remote.test'));
  assert.throws(() => prepare(output + '-placeholder', 'https://journal.example.invalid'));
});
test('a second writer cannot acquire the same log and no stale lock is removed automatically', t => {
  const f = fixture(t), release = acquireWriterLock(f.file, f.journalId);
  assert.throws(() => acquireWriterLock(f.file, f.journalId));
  release(); const second = acquireWriterLock(f.file, f.journalId); second();
});
test('durable intents survive reopening and initialization cannot overwrite history', t => {
  const f = fixture(t), entry = f.store.append(intent());
  assert.throws(() => initialize(f.file, f.journalId));
  const reopened = new JournalStore(f); t.after(() => reopened.close());
  assert.deepEqual(reopened.entries, [entry]);
  assert.deepEqual(f.store.append(entry.intent), entry);
  assert.throws(() => f.store.append({ ...entry.intent, reason: 'BLOCK' }), /ID_REUSED/);
});
test('torn, tampered, missing or wrong-identity journals stop rather than repair themselves', t => {
  const f = fixture(t); f.store.append(intent());
  const original = fs.readFileSync(f.file, 'utf8');
  for (const text of [original.slice(0, -1), original.replace('synthetic-user', 'forged-user'), '']) {
    fs.writeFileSync(f.file, text); assert.throws(() => new JournalStore(f));
  }
  fs.writeFileSync(f.file, original);
  assert.throws(() => new JournalStore({ ...f, journalId: randomUUID() }));
  assert.throws(() => new JournalStore({ ...f, file: f.file + '.missing' }));
});
test('checkpoint rejects stale, altered, wrong-key and replayed-nonce responses', t => {
  const f = fixture(t), nonce = randomBytes(32).toString('base64url'); f.store.append(intent());
  const cp = f.store.checkpoint(nonce);
  assert.equal(verifyCheckpoint(cp, f.publicKey, f.journalId, nonce).sequence, 1);
  // JSONB and other serializers may reorder object properties in audit receipts.
  const reordered = { ...cp, payload: Object.fromEntries(Object.entries(cp.payload).sort(([a], [b]) => a.localeCompare(b))) };
  assert.equal(verifyCheckpoint(reordered, f.publicKey, f.journalId, nonce).sequence, 1);
  assert.throws(() => verifyCheckpoint(cp, f.publicKey, f.journalId, 'other-nonce'));
  assert.throws(() => verifyCheckpoint(cp, f.publicKey, f.journalId, nonce, cp.payload.issuedAt + 10001));
  const otherKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => verifyCheckpoint(cp, otherKey, f.journalId, nonce));
  cp.payload.sequence++;
  assert.throws(() => verifyCheckpoint(cp, f.publicKey, f.journalId, nonce));
});
test('chain rejects deletion, reordering and altered intent content', t => {
  const f = fixture(t); f.store.append(intent()); f.store.append(intent());
  for (const rows of [[f.store.entries[1]], [...f.store.entries].reverse(), [{ ...f.store.entries[0], intent: intent() }]])
    assert.throws(() => verifyEntries(rows, f.journalId, 0, genesis(f.journalId)));
});
test('network append and signed paginated recovery have no unauthenticated read/delete routes', async t => {
  const f = fixture(t); f.server.listen(0, '127.0.0.1'); await once(f.server, 'listening');
  const origin = 'http://127.0.0.1:' + f.server.address().port;
  const client = new JournalClient({ ...f, origin, allowLocalHttp: true });
  await assert.rejects(fetch(origin + '/read', { method: 'POST' }).then(r => { assert.equal(r.status, 401); throw Error('expected'); }));
  const created = await Promise.all(Array.from({ length: 8 }, () => client.prepare(intent())));
  assert.equal((await client.head()).sequence, 8);
  assert.equal(new Set(created.map(e => e.sequence)).size, 8);
  // Exercise the page boundary without using real account data.
  for (let i = 8; i < 1002; i++) f.store.append(intent());
  const snapshot = await client.snapshot();
  assert.equal(snapshot.entries.length, 1002);
  assert.equal(snapshot.checkpoint.headHash, f.store.entries.at(-1).hash);
  const response = await fetch(origin + '/delete', { method: 'POST', headers: { authorization: 'Bearer ' + f.token } });
  assert.equal(response.status, 404);
});
test('production client rejects insecure remote origins and credentials in URL', () => {
  const pair = generateKeyPairSync('ed25519');
  const base = { journalId: randomUUID(), token: randomBytes(32).toString('base64url'), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) };
  for (const origin of ['http://remote.test', 'https://user:password@remote.test', 'https://remote.test/path'])
    assert.throws(() => new JournalClient({ ...base, origin }));
});
