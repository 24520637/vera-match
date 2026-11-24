#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const { isAbsolute } = require('node:path');
function checkEnvironment(env) {
  const issues = [];
  if (env.RECOVERY_MODE !== undefined && env.RECOVERY_MODE !== 'normal') {
    issues.push('RECOVERY_MODE must be normal to start the API');
  }
  if (env.NODE_ENV !== 'production') issues.push('NODE_ENV must be production');
  if (!env.RECOVERY_JOURNAL_CLIENT_CONFIG || !isAbsolute(env.RECOVERY_JOURNAL_CLIENT_CONFIG)) {
    issues.push('RECOVERY_JOURNAL_CLIENT_CONFIG must identify an absolute independent-journal client configuration file');
  }
  if (env.API_DOCS_MODE !== 'public') issues.push('API_DOCS_MODE must be public for this documented public demo');
  if (!/^[a-f0-9]{64}$/i.test(env.MATCHING_HANDLE_KEY ?? '')) {
    issues.push('MATCHING_HANDLE_KEY must be a 32-byte key encoded as 64 hexadecimal characters');
  }
  if (!env.API_INTERNAL_ORIGIN) issues.push('API_INTERNAL_ORIGIN is required at web build and runtime');
  else {
    try { const u = new URL(env.API_INTERNAL_ORIGIN); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error(); }
    catch { issues.push('API_INTERNAL_ORIGIN must be a credential-free HTTP(S) origin'); }
  }
  if (!env.VIDEO_DURATION_FFPROBE) issues.push('VIDEO_DURATION_FFPROBE must identify the installed native decoder');
  return issues;
}
function checkRealUserPaths(env) {
  return ['CONSENT_POLICY_MANIFEST_PATH', 'CONSENT_POLICY_APPROVAL_PUBLIC_KEY_PATH',
    'CLOSURE_POLICY_MANIFEST_PATH', 'CLOSURE_POLICY_APPROVAL_PUBLIC_KEY_PATH',
    'STAFF_AUTHORITY_KEYS_PATH', 'STAFF_MFA_KEYRING_PATH',
    'EXPERT_QUALIFICATION_MANIFEST_PATH', 'EXPERT_QUALIFICATION_PUBLIC_KEY_PATH']
    .filter(key => typeof env[key] !== 'string' || !isAbsolute(env[key]))
    .map(key => key + ' requires an absolute approved configuration file path for real-user preparation');
}
async function smoke(origin, fetcher = fetch) {
  const u = new URL(origin);
  if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('Supply one credential-free HTTPS origin');
  const checks = [
    ['/', 200],
    ['/api', 200],
    ['/api/health', 200],
    ['/api/health/ready', 200],
    ['/api/docs', 200],
    ['/api/docs/swagger-ui-init.js', 200],
    ['/api/docs-json', 200],
    ['/api/auth/me', 401],
    ['/api/videos/me', 401],
  ];
  for (const [path, expected] of checks) {
    const response = await fetcher(new URL(path,u), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    try {
      if (response.status !== expected) throw new Error(path + ' unexpected HTTP status');
      if (path === '/api') {
        const root = await response.json();
        if (root?.service !== 'vera-api' || root.health !== '/api/health' || root.readiness !== '/api/health/ready') {
          throw new Error('/api invalid discovery payload');
        }
      }
      if (path === '/api/health' || path === '/api/health/ready') {
        const health = await response.json();
        if (health.service !== 'vera-api' || health.status !== (path.endsWith('/ready') ? 'ready' : 'ok') || path.endsWith('/ready') && health.database !== 'ok') throw new Error(path + ' invalid health payload');
      }
      if (path === '/api/docs' && !(await response.text()).includes('id="swagger-ui"')) {
        throw new Error('Expected Swagger UI at /api/docs');
      }
      if (path === '/api/docs/swagger-ui-init.js') {
        const script = await response.text();
        if (!script.includes('SwaggerUIBundle') || !/"supportedSubmitMethods"\s*:\s*\[\s*\]/.test(script) || !/"persistAuthorization"\s*:\s*false/.test(script)) {
          throw new Error('Expected read-only Swagger UI with authorization persistence disabled');
        }
      }
      if (path === '/api/docs-json') {
        const spec = await response.json();
        if (!String(spec.openapi).startsWith('3.') || !spec.paths?.['/api']?.get || !spec.paths?.['/api/auth/login'] || !spec.paths?.['/api/matches/recommendations'] || !spec.paths?.['/api/account-closure']) throw new Error('Public OpenAPI contract is incomplete');
      }
    } finally { if (!response.bodyUsed) await response.body?.cancel(); }
  }
}
async function main() {
  if (process.argv[2] === '--url') {
    await smoke(process.argv[3]);
    console.log('PASS public HTTPS, documentation, readiness and unauthenticated boundaries. This is not production sign-off.');
    return;
  }
  const issues = checkEnvironment(process.env);
  const realUsers = process.argv.includes('--real-users');
  if (realUsers) issues.push(...checkRealUserPaths(process.env));
  // Reuse the actual API parser; no database connection, migration or SMTP delivery occurs.
  let parse;
  try { parse = require('../apps/api/dist/config/environment.js').parseEnvironment; }
  catch { issues.push('Build the API before running environment preflight'); }
  if (parse) { try { parse(process.env); } catch (e) { issues.push(e.name === 'ConfigurationError' ? e.message : 'API configuration validation failed'); } }
  if (parse && process.env.RECOVERY_JOURNAL_CLIENT_CONFIG) {
    try {
      const { RecoveryJournalService } = require('../apps/api/dist/recovery/recovery-journal.service.js');
      new RecoveryJournalService({}, { values: { nodeEnv: 'production' } });
    } catch { issues.push('Independent journal client files, public key and access token require validation'); }
  }
  if (realUsers && !checkRealUserPaths(process.env).length) {
    const validators = [
      ['Approved consent publication', () => {
        const { ConsentPolicyRegistry } = require('../apps/api/dist/consent/consent.policy.js');
        const registry = new ConsentPolicyRegistry();
        if (registry.list('en').length !== 5 || registry.list('vi').length !== 5) throw Error();
      }],
      ['Approved closure minimization policy', () => {
        const { ClosurePolicyRegistry } = require('../apps/api/dist/account-closure/closure-policy.js');
        if (!new ClosurePolicyRegistry().current()) throw Error();
      }],
      ['Trusted staff authority', () => { const { StaffAuthority } = require('../apps/api/dist/staff-security/staff-authority.js'); new StaffAuthority(); }],
      ['Staff MFA keyring', () => { const { StaffMfaKeyring } = require('../apps/api/dist/staff-security/staff-mfa-keyring.js'); new StaffMfaKeyring().box; }],
      ['Signed expert qualification publication', () => { const { currentQualification } = require('../apps/api/dist/expert-admin/expert-qualification.publication.js'); if (!currentQualification()) throw Error(); }],
    ];
    for (const [name, validate] of validators) try { validate(); } catch { issues.push(name + ' requires validation'); }
  }
  if (process.env.VIDEO_DURATION_FFPROBE) {
    const decoder = spawnSync(process.env.VIDEO_DURATION_FFPROBE, ['-version'], { windowsHide: true, timeout: 10000, stdio: 'ignore' });
    if (decoder.status !== 0) issues.push('Native FFprobe execution failed');
  }
  if (issues.length) throw new Error(issues.join('; '));
  console.log('PASS static deployment configuration and native decoder. No services were contacted; runtime release gates remain enforced.');
}
module.exports = { checkEnvironment, checkRealUserPaths, smoke };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
