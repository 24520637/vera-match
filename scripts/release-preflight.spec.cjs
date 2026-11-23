const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkEnvironment, smoke } = require('./release-preflight.cjs');

function publicResponse(path) {
  if (path === '/api') {
    return Response.json({ service: 'vera-api', health: '/api/health', readiness: '/api/health/ready' });
  }
  if (path === '/api/health' || path === '/api/health/ready') {
    return Response.json({ service: 'vera-api', status: path.endsWith('/ready') ? 'ready' : 'ok', database: 'ok' });
  }
  if (path === '/api/docs') return new Response('<div id="swagger-ui"></div>');
  if (path === '/api/docs/swagger-ui-init.js') {
    return new Response('SwaggerUIBundle({ "supportedSubmitMethods": [], "persistAuthorization": false });');
  }
  if (path === '/api/docs-json') {
    return Response.json({
      openapi: '3.0.0',
      paths: { '/api': { get: {} }, '/api/auth/login': {}, '/api/matches/recommendations': {}, '/api/account-closure': {} },
    });
  }
  return new Response('', { status: ['/api/auth/me', '/api/videos/me'].includes(path) ? 401 : 200 });
}

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
    return publicResponse(url.pathname);
  });
  assert.equal(paths.length, 9);
  assert.ok(paths.every(path => !path.includes('reset-password')));
});

test('does not accept a frontend HTML fallback as API health', async () => {
  await assert.rejects(smoke('https://host.test', async ({ pathname }) => (
    pathname === '/api/health' ? Response.json({}) : publicResponse(pathname)
  )), /invalid health payload/);
});

test('rejects a frontend fallback at the Swagger UI route', async () => {
  await assert.rejects(smoke('https://host.test', async ({ pathname }) => (
    pathname === '/api/docs' ? new Response('<html>Homepage</html>') : publicResponse(pathname)
  )), /Expected Swagger UI/);
});

test('rejects a Swagger initializer that allows mutations or persists authorization', async () => {
  for (const settings of [
    '"supportedSubmitMethods": ["post"], "persistAuthorization": false',
    '"supportedSubmitMethods": [], "persistAuthorization": true',
  ]) {
    await assert.rejects(smoke('https://host.test', async ({ pathname }) => (
      pathname === '/api/docs/swagger-ui-init.js'
        ? new Response(`SwaggerUIBundle({ ${settings} });`)
        : publicResponse(pathname)
    )), /Expected read-only Swagger UI/);
  }
});
