import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { request as tlsRequest } from "node:https";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const origin = "https://vera.test:3443";
const password = "synthetic-https-password-only";
let db: PrismaClient;
test.beforeAll(async () => {
  const metadata = JSON.parse(await readFile(resolve(__dirname, "../.auth-e2e-runtime.json"), "utf8"));
  const url = new URL(process.env.DATABASE_URL || "");
  if (metadata.kind !== "vera-auth-e2e-v1" || metadata.runId !== process.env.VERA_HTTPS_E2E_RUN_ID ||
      metadata.runId !== process.env.VERA_AUTH_E2E_RUN_ID || !/^vera_auth_test_[a-f0-9]{32}$/.test(metadata.schema) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port !== "5433")
    throw new Error("Disposable HTTPS database required");
  url.searchParams.set("schema", metadata.schema);
  db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
});
test.afterAll(async () => { await db?.$disconnect(); });

async function signIn(page: Page, email?: string) {
  if (!email) {
    email = randomUUID() + "@https.example.invalid";
    await db.user.create({ data: { email, passwordHash: await argon2.hash(password, {
      type: argon2.argon2id, memoryCost: 8192, timeCost: 1, parallelism: 1,
    }), status: "ACTIVE", emailVerifiedAt: new Date(), declaredAdult: true } });
  }
  await page.goto(origin + "/login");
  const form = page.getByRole("form", { name: "Sign in", exact: true });
  await form.getByLabel("Email address").fill(email);
  await form.getByLabel("Password", { exact: false }).fill(password);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/login" && r.request().method() === "POST");
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  const login = await response;
  expect(login.status()).toBe(200);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  return { email, setCookie: (await login.allHeaders())["set-cookie"] || "" };
}
async function session(context: BrowserContext) {
  const cookie = (await context.cookies(origin)).find(c => c.name === "vera_e2e_session");
  expect(Boolean(cookie)).toBe(true);
  return cookie!;
}
// Real validated TLS, preserving SNI/Host while routing only to loopback.
// Response bodies and bearer values are never attached to assertion messages.
async function post(path: string, headers: Record<string, string>, data: object = {}) {
  return new Promise<{ status: number; body: string; retry?: string }>((resolve, reject) => {
    const request = tlsRequest({ hostname: "127.0.0.1", servername: "vera.test", port: 3443,
      path: "/api/auth/" + path, method: "POST", headers: { Host: "vera.test:3443", "Content-Type": "application/json", ...headers } }, response => {
      let body = "";
      response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode!, body, retry: response.headers["retry-after"] }));
    });
    request.on("error", () => reject(new Error("Loopback TLS request failed")));
    request.end(JSON.stringify(data));
  });
}

test("C084 validates TLS and enforces Secure, HttpOnly and host-only browser boundaries", async ({ page, context }) => {
  await expect(page.goto("https://unknown.vera.test:3443/__tls-probe")).rejects.toThrow();
  const { setCookie } = await signIn(page);
  expect(/;\s*Secure/i.test(setCookie) && /;\s*HttpOnly/i.test(setCookie)).toBe(true);
  expect(/;\s*Domain=/i.test(setCookie)).toBe(false);
  const cookie = await session(context);
  expect({ secure: cookie.secure, httpOnly: cookie.httpOnly, domain: cookie.domain, sameSite: cookie.sameSite, path: cookie.path })
    .toEqual({ secure: true, httpOnly: true, domain: "vera.test", sameSite: "Lax", path: "/" });
  expect(await page.evaluate(() => document.cookie === "" && localStorage.length === 0 && sessionStorage.length === 0)).toBe(true);
  for (const url of ["https://sibling.vera.test:3443/__tls-probe", "http://vera.test:3444/__tls-probe"]) {
    await page.goto(url);
    expect(JSON.parse(await page.locator("body").innerText()).cookieReceived).toBe(false);
  }
  await page.goto("https://foreign.test:3443/__tls-probe");
  await page.setContent('<form method="POST" action="https://vera.test:3443/__tls-probe"><button>Probe POST</button></form>');
  await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: "Probe POST" }).click()]);
  expect(JSON.parse(await page.locator("body").innerText()).cookieReceived).toBe(false);
  await page.goto("https://foreign.test:3443/__tls-probe");
  await page.setContent('<a href="https://vera.test:3443/__tls-probe">Probe safe navigation</a>');
  await Promise.all([page.waitForNavigation(), page.getByRole("link", { name: "Probe safe navigation" }).click()]);
  expect(JSON.parse(await page.locator("body").innerText()).cookieReceived).toBe(true);
});

test("C084 rejects forged origins and cross-site POST without revoking the valid session", async ({ page, context }) => {
  const { email } = await signIn(page);
  const cookie = await session(context);
  const deniedHeaders: Record<string, string>[] = [{ Origin: "https://foreign.test:3443" }, {}, { Origin: origin, "Sec-Fetch-Site": "cross-site" }];
  for (const headers of deniedHeaders) {
    const result = await post("logout", { Cookie: cookie.name + "=" + cookie.value, ...headers });
    expect(result.status).toBe(403);
    expect(result.body.includes(cookie.value) || result.body.includes(password)).toBe(false);
  }
  await page.goto("https://foreign.test:3443/__tls-probe");
  await page.setContent('<form method="POST" action="https://vera.test:3443/api/auth/logout"><button>Cross-site mutation</button></form>');
  const navigation = page.waitForNavigation();
  await page.getByRole("button", { name: "Cross-site mutation" }).click();
  expect((await navigation)?.status()).toBe(403);
  await page.goto(origin + "/account");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});

for (const revoke of [false, true]) test("C084 HTTPS offline recovery " + (revoke ? "honors remote logout-all" : "restores the original session"), async ({ page, context, browser }) => {
  const { email } = await signIn(page);
  const before = await session(context);
  const logs: string[] = [];
  page.on("console", message => logs.push(message.text()));
  const other = await browser.newContext();
  try {
    const remote = await other.newPage();
    if (revoke) await signIn(remote, email);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("We could not check your session.", { exact: true })).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);
    expect((await session(context)).value === before.value).toBe(true);
    if (revoke) expect(await remote.evaluate(async () => (await fetch("/api/auth/logout-all", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    })).status)).toBe(204);
    await context.setOffline(false);
    if (revoke) {
      await expect(page).toHaveURL(/\/login/);
      expect(await page.evaluate(async () => (await fetch("/api/auth/me")).status)).toBe(401);
    }
    else {
      await expect(page.getByText(email, { exact: true })).toBeVisible();
      expect((await session(context)).value === before.value).toBe(true);
      expect(await page.evaluate(() => document.cookie === "" && localStorage.length === 0 && sessionStorage.length === 0)).toBe(true);
    }
    expect(page.url().includes(before.value) || logs.some(line => line.includes(before.value) || line.includes(password))).toBe(false);
  } finally { await context.setOffline(false); await other.close(); }
});

test("C084 forwarding claims cannot evade the real proxy/API IP quota", async () => {
  const statuses: number[] = [];
  for (let index = 0; index < 12; index++) {
    const response = await post("forgot-password", { Origin: origin,
      "X-Forwarded-For": "198.51.100." + index, "X-Real-IP": "203.0.113." + index,
      "Forwarded": "for=198.51.100." + index + ";proto=http", "X-Forwarded-Proto": "http", "X-Forwarded-Host": "foreign.test:3443" },
    { email: randomUUID() + "@absent.example.invalid" });
    statuses.push(response.status);
    if (response.status === 429) expect(Boolean(response.retry && /^\d+$/.test(response.retry))).toBe(true);
  }
  expect(statuses.every(status => status === 202 || status === 429) && statuses.includes(429) && statuses.at(-1) === 429).toBe(true);
  // Direct origin access shares the same socket-IP limit; arbitrary forwarding claims confer no trust.
  const direct = await fetch("http://127.0.0.1:4140/api/auth/forgot-password", { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.200" },
    body: JSON.stringify({ email: randomUUID() + "@absent.example.invalid" }) });
  expect(direct.status).toBe(429);
});
