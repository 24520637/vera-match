'use strict';
const { createHash, createPublicKey, randomBytes, verify } = require('node:crypto');
const reasons = new Set(['DATABASE_BASELINE', 'ACCOUNT_CLOSURE', 'CONSENT_WITHDRAWAL', 'BLOCK', 'SESSION_REVOCATION', 'PASSWORD_RESET', 'STAFF_RESTRICTION', 'VIDEO_REMOVAL', 'CLAIM_RESTRICTION']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
function validateIntent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'id,reason,userIds' ||
      !uuid.test(value.id) || !reasons.has(value.reason) || !Array.isArray(value.userIds) || value.userIds.length < 1 || value.userIds.length > 2 ||
      value.userIds.some(x => typeof x !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(x)) ||
      [...new Set(value.userIds)].sort().join(',') !== value.userIds.join(',')) throw new Error('JOURNAL_INTENT_INVALID');
  return { id: value.id, reason: value.reason, userIds: [...value.userIds] };
}
const genesis = journalId => hash('VERA:RECOVERY-JOURNAL:GENESIS:v1:' + journalId);
function entryHash(entry) {
  return hash('VERA:RECOVERY-JOURNAL:ENTRY:v1\n' + JSON.stringify({ journalId: entry.journalId, sequence: entry.sequence,
    previousHash: entry.previousHash, createdAt: entry.createdAt, intent: validateIntent(entry.intent) }));
}
const checkpointMessage = payload => Buffer.from('VERA:RECOVERY-JOURNAL:CHECKPOINT:v1\n' + JSON.stringify({
  journalId: payload.journalId, nonce: payload.nonce, sequence: payload.sequence, headHash: payload.headHash, issuedAt: payload.issuedAt,
}), 'utf8');
function verifyCheckpoint(envelope, publicKey, journalId, nonce, now = Date.now()) {
  try {
    if (!envelope || Object.keys(envelope).sort().join(',') !== 'payload,signature') throw Error();
    const p = envelope.payload;
    if (!p || Object.keys(p).sort().join(',') !== 'headHash,issuedAt,journalId,nonce,sequence' || p.journalId !== journalId || p.nonce !== nonce ||
        !Number.isSafeInteger(p.sequence) || p.sequence < 0 || !/^[a-f0-9]{64}$/.test(p.headHash) ||
        !Number.isSafeInteger(p.issuedAt) || p.issuedAt > now + 1000 || now - p.issuedAt > 10000 ||
        typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) throw Error();
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== 'ed25519' || !verify(null, checkpointMessage(p), key, Buffer.from(envelope.signature, 'base64url'))) throw Error();
    return p;
  } catch { throw new Error('JOURNAL_CHECKPOINT_INVALID'); }
}
function verifyEntries(entries, journalId, previousSequence, previousHash) {
  for (const entry of entries) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'createdAt,hash,intent,journalId,previousHash,sequence' ||
        entry.journalId !== journalId || entry.sequence !== previousSequence + 1 || entry.previousHash !== previousHash ||
        typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt)) || new Date(entry.createdAt).toISOString() !== entry.createdAt || entry.hash !== entryHash(entry))
      throw new Error('JOURNAL_CHAIN_INVALID');
    previousSequence = entry.sequence; previousHash = entry.hash;
  }
  return { sequence: previousSequence, headHash: previousHash };
}
class JournalClient {
  constructor({ origin, token, publicKey, journalId, allowLocalHttp = false }) {
    const url = new URL(origin);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        !(url.protocol === 'https:' || allowLocalHttp && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)) ||
        !uuid.test(journalId) || !/^[A-Za-z0-9_-]{43}$/.test(token) || publicKey.includes('PRIVATE KEY') ||
        Buffer.byteLength(publicKey) > 16384 || createPublicKey(publicKey).asymmetricKeyType !== 'ed25519') throw new Error('JOURNAL_CONFIGURATION_INVALID');
    this.origin = url.origin; this.token = token; this.publicKey = publicKey; this.journalId = journalId;
  }
  async request(route, body) {
    const response = await fetch(this.origin + route, { method: 'POST', redirect: 'error',
      headers: { authorization: 'Bearer ' + this.token, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    if (!response.ok || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new Error('JOURNAL_UNAVAILABLE');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) { await response.body.cancel().catch(() => {}); throw new Error('JOURNAL_RESPONSE_TOO_LARGE'); } chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async prepare(intent) {
    validateIntent(intent);
    const nonce = randomBytes(32).toString('base64url');
    const response = await this.request('/prepare', { nonce, intent });
    const checkpoint = verifyCheckpoint(response.checkpoint, this.publicKey, this.journalId, nonce);
    const entry = response.entry;
    verifyEntries([entry], this.journalId, entry.sequence - 1, entry.previousHash);
    if (checkpoint.sequence !== entry.sequence || checkpoint.headHash !== entry.hash || JSON.stringify(entry.intent) !== JSON.stringify(validateIntent(intent))) throw new Error('JOURNAL_APPEND_UNVERIFIED');
    return entry;
  }
  async head() {
    const nonce = randomBytes(32).toString('base64url');
    const response = await this.request('/checkpoint', { nonce });
    return verifyCheckpoint(response.checkpoint, this.publicKey, this.journalId, nonce);
  }
  async snapshot() {
    const entries = []; let sequence = 0, headHash = genesis(this.journalId), target, envelope;
    do {
      const nonce = randomBytes(32).toString('base64url');
      const page = await this.request('/read', { nonce, after: sequence, through: target?.sequence ?? null });
      const checkpoint = verifyCheckpoint(page.checkpoint, this.publicKey, this.journalId, nonce);
      envelope = page.checkpoint;
      if (!target) target = checkpoint;
      if (checkpoint.sequence !== target.sequence || checkpoint.headHash !== target.headHash || !Array.isArray(page.entries) ||
          page.entries.length > 1000 || page.entries.length === 0 && sequence < target.sequence) throw new Error('JOURNAL_SNAPSHOT_CHANGED');
      ({ sequence, headHash } = verifyEntries(page.entries, this.journalId, sequence, headHash));
      if (sequence > target.sequence || entries.length + page.entries.length > 1000000) throw new Error('JOURNAL_SNAPSHOT_INVALID');
      entries.push(...page.entries);
    } while (sequence < target.sequence);
    if (headHash !== target.headHash) throw new Error('JOURNAL_HEAD_MISMATCH');
    return { entries, checkpoint: target, envelope };
  }
}
module.exports = { validateIntent, genesis, entryHash, checkpointMessage, verifyCheckpoint, verifyEntries, JournalClient };
