import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readActivationEmail, clearTestEmails } from '../../api/test/mailpit-fixtures';

test('restores a real HttpOnly session after refresh and browser-context reopen', async ({ page, context, browser }) => {
  const email = `browser-${randomUUID()}@example.invalid`; const password = 'synthetic-browser-password';
  const post = (path: string, data: object) => context.request.post(`http://localhost:4100/api/auth/${path}`, { headers: { Origin: 'http://localhost:3100' }, data });
  try {
    expect((await post('register', { email, password, declaredAdult: true })).status()).toBe(202);
    const activation = await readActivationEmail(email); expect((await post('verify-email', { token: activation.token })).status()).toBe(200);
    expect((await post('login', { email, password })).status()).toBe(200);
    await page.goto('/account'); await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByText(email, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
    const stored = await context.storageState(); expect(stored.cookies.some(cookie => cookie.httpOnly && cookie.expires > Date.now() / 1000)).toBe(true);
    const reopened = await browser.newContext({ storageState: stored });
    try { const other = await reopened.newPage(); await other.goto('http://localhost:3100/account'); await expect(other.getByText(email, { exact: true })).toBeVisible(); } finally { await reopened.close(); }
  } finally { await clearTestEmails(email); }
});
