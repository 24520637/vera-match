'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, generateKeyPairSync } = require('node:crypto');
function prepare(directory, origin) {
  const root = path.resolve(__dirname, '../..');
  const target = path.resolve(directory);
  const relative = path.relative(root, target);
  const url = new URL(origin);
  if (!path.isAbsolute(directory) || !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) || url.protocol !== 'https:' ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      /(^|\.)(localhost|invalid|test)$/.test(url.hostname) || /YOUR_DOMAIN|REPLACE_/i.test(url.hostname)) throw new Error('Use a real HTTPS journal origin and a new absolute directory outside the checkout');
  // No overwrite or automatic key rotation on a repeated setup command.
  fs.mkdirSync(target, { mode: 0o700 });
  for (const name of ['server', 'client']) fs.mkdirSync(path.join(target, name), { mode: 0o700 });
  const journalId = randomUUID(), token = randomBytes(32).toString('base64url'), keys = generateKeyPairSync('ed25519');
  const write = (name, value) => fs.writeFileSync(path.join(target, name), value, { mode: 0o600, flag: 'wx' });
  write('server/signing-private.pem', keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  write('server/api-token', token + '\n');
  write('client/journal-public.pem', keys.publicKey.export({ type: 'spki', format: 'pem' }));
  write('client/api-token', token + '\n');
  write('server/server.json', JSON.stringify({ journalId, file: '/var/lib/vera-journal/restrictions.jsonl',
    privateKeyPath: '/etc/vera-journal/signing-private.pem', tokenPath: '/etc/vera-journal/api-token', port: 4100 }, null, 2) + '\n');
  write('client/client.json', JSON.stringify({ journalId, origin: url.origin,
    publicKeyPath: '/etc/vera-match/recovery/journal-public.pem', tokenPath: '/etc/vera-match/recovery/api-token' }, null, 2) + '\n');
  write('HANDOFF.txt', 'SECRET CONFIGURATION: never commit, attach to chat or include in the source archive.\n' +
    'Transfer server/ to the independent journal host only; keep its signing key off the API host.\n' +
    'Transfer client/ to /etc/vera-match/recovery on the API host with root:vera ownership, files 0640 and directory 0750.\n' +
    'Set RECOVERY_JOURNAL_CLIENT_CONFIG=/etc/vera-match/recovery/client.json.\n' +
    'Initialize a new journal only once. Never restore/replace journal state alongside an application DB backup.\n' +
    'Back up journal state/key custody independently; protect the generated directory with host ACLs on Windows.\n');
  return target;
}
if (require.main === module) {
  try {
    if (process.argv.length !== 6 || process.argv[2] !== '--directory' || process.argv[4] !== '--origin') throw Error('Arguments: --directory ABSOLUTE_NEW_DIRECTORY --origin https://journal.your-domain');
    console.log('Secret host configuration created outside checkout: ' + prepare(process.argv[3], process.argv[5]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare };
