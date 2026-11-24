'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { sign, timingSafeEqual, createPrivateKey, createPublicKey } = require('node:crypto');
const { validateIntent, genesis, entryHash, checkpointMessage, verifyEntries } = require('./protocol.cjs');
function acquireWriterLock(file, journalId) {
  const lock = file + '.writer-lock';
  const fd = fs.openSync(lock, 'wx', 0o600);
  const identity = JSON.stringify({ journalId, pid: process.pid });
  fs.writeFileSync(fd, identity); fs.fsyncSync(fd); fs.closeSync(fd);
  let released = false;
  return () => {
    if (released) return;
    if (fs.readFileSync(lock, 'utf8') !== identity) throw new Error('JOURNAL_LOCK_CHANGED');
    fs.unlinkSync(lock); released = true;
  };
}
class JournalStore {
  constructor({ file, journalId, privateKey }) {
    this.file = file; this.journalId = journalId; this.privateKey = createPrivateKey(privateKey);
    if (this.privateKey.asymmetricKeyType !== 'ed25519' || !path.isAbsolute(file) || fs.lstatSync(file).isSymbolicLink()) throw new Error('JOURNAL_CONFIGURATION_INVALID');
    const lines = fs.readFileSync(file, 'utf8');
    // A missing/torn/empty log is never silently recreated or repaired.
    if (!lines.endsWith('\n')) throw new Error('JOURNAL_LOG_INCOMPLETE');
    const [header, ...entries] = lines.trimEnd().split('\n').map(line => JSON.parse(line));
    if (JSON.stringify(header) !== JSON.stringify({ schemaVersion: 1, journalId, genesis: genesis(journalId) })) throw new Error('JOURNAL_IDENTITY_MISMATCH');
    verifyEntries(entries, journalId, 0, genesis(journalId));
    this.entries = entries; this.byId = new Map(); this.failed = false;
    for (const entry of entries) { if (this.byId.has(entry.intent.id)) throw new Error('JOURNAL_DUPLICATE_ID'); this.byId.set(entry.intent.id, entry); }
    this.fd = fs.openSync(file, 'a');
  }
  checkpoint(nonce, sequence = this.entries.length) {
    if (this.failed || !Number.isSafeInteger(sequence) || sequence < 0 || sequence > this.entries.length) throw new Error('JOURNAL_UNAVAILABLE');
    const payload = { journalId: this.journalId, nonce, sequence, headHash: sequence ? this.entries[sequence - 1].hash : genesis(this.journalId), issuedAt: Date.now() };
    return { payload, signature: sign(null, checkpointMessage(payload), this.privateKey).toString('base64url') };
  }
  append(intent) {
    validateIntent(intent);
    if (this.failed) throw new Error('JOURNAL_UNAVAILABLE');
    const existing = this.byId.get(intent.id);
    if (existing) { if (JSON.stringify(existing.intent) !== JSON.stringify(validateIntent(intent))) throw new Error('JOURNAL_ID_REUSED'); return existing; }
    const entry = { journalId: this.journalId, sequence: this.entries.length + 1,
      previousHash: this.entries.at(-1)?.hash ?? genesis(this.journalId), createdAt: new Date().toISOString(), intent: validateIntent(intent) };
    entry.hash = entryHash(entry);
    try {
      const bytes = Buffer.from(JSON.stringify(entry) + '\n'); let offset = 0;
      while (offset < bytes.length) { const n = fs.writeSync(this.fd, bytes, offset, bytes.length - offset); if (!n) throw Error(); offset += n; }
      fs.fsyncSync(this.fd);
    } catch { this.failed = true; throw new Error('JOURNAL_DURABILITY_UNCONFIRMED'); }
    this.entries.push(entry); this.byId.set(intent.id, entry); return entry;
  }
  close() { fs.closeSync(this.fd); }
}
function initialize(file, journalId) {
  if (!path.isAbsolute(file) || !/^[a-f0-9-]{36}$/.test(journalId)) throw new Error('JOURNAL_CONFIGURATION_INVALID');
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 1, journalId, genesis: genesis(journalId) }) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  // Persist creation of the directory entry on the Linux production host.
  if (process.platform !== 'win32') { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
}
function createServer(store, token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('JOURNAL_TOKEN_INVALID');
  const expected = Buffer.from('Bearer ' + token);
  const server = http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store'); res.setHeader('content-type', 'application/json');
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end('{"code":"UNAUTHORIZED"}'); req.resume(); return; }
    if (req.method !== 'POST' || !['/prepare', '/read', '/checkpoint'].includes(req.url) || req.headers['content-type'] !== 'application/json') { res.writeHead(404); res.end('{}'); req.resume(); return; }
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 4096) throw new Error('BODY_TOO_LARGE'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || !/^[A-Za-z0-9_-]{43}$/.test(body.nonce)) throw new Error('INVALID_NONCE');
      let result;
      if (req.url === '/checkpoint') {
        if (Object.keys(body).join(',') !== 'nonce') throw Error();
        result = { checkpoint: store.checkpoint(body.nonce) };
      } else if (req.url === '/prepare') {
        if (Object.keys(body).sort().join(',') !== 'intent,nonce') throw Error();
        const entry = store.append(body.intent);
        result = { entry, checkpoint: store.checkpoint(body.nonce, entry.sequence) };
      } else {
        if (Object.keys(body).sort().join(',') !== 'after,nonce,through' || !Number.isSafeInteger(body.after) || body.after < 0) throw Error();
        const through = body.through === null ? store.entries.length : body.through;
        if (!Number.isSafeInteger(through) || through < body.after || through > store.entries.length) throw Error();
        result = { entries: store.entries.slice(body.after, Math.min(body.after + 1000, through)), checkpoint: store.checkpoint(body.nonce, through) };
      }
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(store.failed ? 503 : 400); res.end('{"code":"JOURNAL_REQUEST_FAILED"}');
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 16;
  return server;
}
if (require.main === module) {
  try {
    const configPath = process.env.JOURNAL_SERVER_CONFIG;
    if (!configPath || !path.isAbsolute(configPath)) throw new Error('JOURNAL_SERVER_CONFIG_REQUIRED');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (process.argv[2] === '--initialize') { initialize(config.file, config.journalId); console.log('Journal initialized; protect its independent identity and storage.'); }
    else {
      const releaseLock = acquireWriterLock(config.file, config.journalId);
      // A hard kill deliberately leaves a stale lock. An operator must establish
      // that no writer remains before removing it; never guess and start two.
      process.once('exit', () => { try { releaseLock(); } catch { /* remain fenced */ } });
      const store = new JournalStore({ ...config, privateKey: fs.readFileSync(config.privateKeyPath, 'utf8') });
      const server = createServer(store, fs.readFileSync(config.tokenPath, 'utf8').trim());
      const port = config.port ?? 4100;
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('JOURNAL_PORT_INVALID');
      server.listen(port, '127.0.0.1');
      const shutdown = () => server.close(() => { store.close(); releaseLock(); });
      process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
    }
  } catch { console.error('JOURNAL_STARTUP_FAILED'); process.exitCode = 1; }
}
module.exports = { JournalStore, initialize, createServer, acquireWriterLock };
