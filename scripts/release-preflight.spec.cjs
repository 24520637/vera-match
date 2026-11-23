const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkEnvironment, smoke } = require('./release-preflight.cjs');
test('rejects missing deployment configuration without exposing supplied secrets', () => {
  const failures = checkEnvironment({ API_INTERNAL_ORIGIN: 'https://user:secret@host.test', VIDEO_DURATION_FFPROBE: 'ffprobe' });
  assert.ok(failures.length); assert.ok(!failures.join(' ').includes('secret'));
});
test('accepts a static explicit production documentation configuration', () => {
  assert.deepEqual(checkEnvironment({ NODE_ENV: 'production', API_DOCS_MODE: 'public', API_INTERNAL_ORIGIN: 'http://127.0.0.1:4000', VIDEO_DURATION_FFPROBE: '/usr/bin/ffprobe' }), []);
});
test('HTTPS smoke rejects HTTP and redirects instead of following them', async () => {
  await assert.rejects(smoke('http://host.test', async () => { throw Error('must not connect'); }));
  await assert.rejects(smoke('https://host.test', async () => new Response('', { status: 302 })), /unexpected HTTP/);
});
test('HTTPS smoke checks only public GETs and protected 401 boundaries', async () => {
  const paths = [];
  await smoke('https://host.test', async url => {
    paths.push(url.pathname);
    return new Response(url.pathname === '/api/docs-json' ? JSON.stringify({ openapi: '3.0.0', paths: { '/api/auth/login': {}, '/api/matches/recommendations': {}, '/api/account-closure': {} } }) : '', { status: ['/api/auth/me','/api/videos/me'].includes(url.pathname) ? 401 : 200 });
  });
  assert.equal(paths.length, 7);
  assert.ok(paths.every(path => !path.includes('reset-password')));
});
