import { expect, test } from '@playwright/test';

test('actual 401 is unauthenticated while 403/500/offline remain distinct', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const status of [401, 403, 500]) {
    await page.route('**/auth/me', route => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3100', 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify({ code: 'SYNTHETIC_STATUS' }) }));
    await page.goto('/');
    await expect(page.getByRole('link', { name: status === 401 ? 'Sign in' : 'Check account access', exact: true })).toBeVisible();
    await expect(page).toHaveURL('/'); await page.unroute('**/auth/me');
  }
  await page.route('**/auth/me', route => route.abort('failed'));
  await page.goto('/'); await expect(page.getByRole('link', { name: 'Check account access', exact: true })).toBeVisible();
});

test('bootstrap keeps session data in memory and renders only a validated user', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3100', 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify({ id: 'synthetic', email: 'synthetic@example.invalid', displayName: 'Example', role: 'MEMBER' }) }));
  await page.goto('/'); await expect(page.getByRole('link', { name: 'Your account', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.reload(); await expect(page.getByRole('link', { name: 'Your account', exact: true })).toBeVisible();
});
