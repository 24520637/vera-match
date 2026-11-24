'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const extras = [
  "apps/api/prisma/migrations/20261124030000_recovery_journal_receipts/migration.sql",
  "apps/api/prisma/migrations/20261124040000_closure_domain_receipts/migration.sql",
  "apps/api/prisma/migrations/20261124050000_recovery_database_binding/migration.sql",
  "apps/api/src/account-closure/closure-policy.spec.ts",
  "apps/api/src/account-closure/closure-policy.ts",
  "apps/api/src/account-closure/closure-reconciliation.service.ts",
  "apps/api/src/recovery/recovery-initialize.main.ts",
  "apps/api/src/recovery/recovery-journal.service.ts",
  "apps/api/src/recovery/recovery.module.ts",
  "apps/api/test/closure-reconciliation.integration-spec.ts",
  "apps/api/test/recovery-journal.integration-spec.ts",
  "deploy/UPLOAD-GUIDE.md",
  "deploy/api.env.example",
  "deploy/install-journal.sh",
  "deploy/nginx/vera-journal.conf",
  "deploy/systemd/vera-journal.service",
  "deploy/web.env.example",
  "docs/DEPLOYMENT-AUDIT.md",
  "docs/PRODUCTION-RECOVERY-AND-CLOSURE.md",
  "docs/production/OWNER-REVIEW.vi.md",
  "docs/production/closure-policy.candidate.json",
  "docs/production/consent-policy.candidate.json",
  "ops/recovery-journal/journal.spec.cjs",
  "ops/recovery-journal/protocol.cjs",
  "ops/recovery-journal/server.cjs",
  "ops/recovery-journal/setup.cjs",
  "scripts/package-deployment.cjs",
  "scripts/recovery-initialize.cjs"
];
function packageDeployment() {
  const files = [...new Set([
    ...execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean),
    ...extras,
  ])].sort();
  const tempRoot = fs.realpathSync(os.tmpdir());
  const staging = fs.mkdtempSync(path.join(tempRoot, 'vera-release-'));
  const output = path.join(root, 'dist', 'release', 'vera-match-source.tar.gz');
  try {
    const manifest = { baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
      status: 'PREPARATION_ONLY_NOT_PRODUCTION_APPROVED', files: {} };
    for (const file of files) {
      if (file.includes('\\') || file.split('/').includes('..') || path.isAbsolute(file) ||
          /(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.env.example') ||
          /\.(pem|key|pfx|dump|sql\.gz)$/i.test(file)) throw new Error('Unsafe release path: ' + file);
      const source = path.join(root, file);
      if (!fs.lstatSync(source).isFile()) throw new Error('Release input must be a regular file: ' + file);
      const content = fs.readFileSync(source);
      const destination = path.join(staging, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
      manifest.files[file] = createHash('sha256').update(content).digest('hex');
    }
    fs.writeFileSync(path.join(staging, 'RELEASE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    execFileSync('tar', ['-czf', output, '-C', staging, '.'], { windowsHide: true, stdio: 'pipe' });
    const hash = createHash('sha256').update(fs.readFileSync(output)).digest('hex');
    fs.writeFileSync(output + '.sha256', hash + '  ' + path.basename(output) + '\n');
    console.log(output);
    console.log('Source archive and checksum created. Read deploy/UPLOAD-GUIDE.md; production gates remain open.');
    return output;
  } finally {
    if (path.dirname(staging) !== tempRoot || !path.basename(staging).startsWith('vera-release-')) throw new Error('Unsafe staging cleanup');
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
if (require.main === module) packageDeployment();
module.exports = { packageDeployment };
