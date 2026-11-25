import { expect, test } from '@playwright/test';
for (const role of ['MEMBER', 'EXPERT'] as const) {
  test(`${role} keeps the appropriate post-login destination`, async ({ page }) => {
    let loggedIn = false;
    const user = { id: 'synthetic-user', role, email: 'demo@example.invalid', displayName: 'Demo' };
    await page.route('**/api/auth/me', route => route.fulfill(loggedIn ? { json: user } : { status: 401, json: { code: 'UNAUTHENTICATED' } }));
    await page.route('**/api/auth/login', route => { loggedIn = true; return route.fulfill({ json: user }); });
    await page.route('**/api/matches/recommendations', route => route.fulfill({ json: { available: false, recommendations: [], nextCursor: null } }));
    await page.route('**/api/matches/decisions', route => route.fulfill({ json: { decisions: [], nextCursor: null } }));
    await page.goto('http://127.0.0.1:3100/login');
    await page.getByLabel('Email address', { exact: false }).fill(user.email);
    await page.getByLabel(/^Password/).fill('SyntheticPassword_123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(role === 'MEMBER' ? /\/account\/matches$/ : /\/account$/);
  });
}
