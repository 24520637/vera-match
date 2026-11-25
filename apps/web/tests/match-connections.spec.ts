import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const endpoint = "**/api/matches/connections/synthetic-connection";
const blank = () => ({ sharing: { revision: 0, profileShared: false, contactShared: false, chatEnabled: false, photo: null },
  peer: { profile: null as null | { displayName: string; age: number; city: string; occupation: string; bio: string;
    relationshipGoal: string; interests: string[]; values: string[]; photo: null }, contactEmail: null as string | null, chatEnabled: false }, chatAvailable: false });
const member = { id: "synthetic-member", role: "MEMBER", email: "member@example.invalid", displayName: "Member" };
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ json: member }));
});
test("mutual history offers the connection link", async ({ page }) => {
  await page.route("**/api/matches/recommendations", route => route.fulfill({ json: { available: true, recommendations: [], nextCursor: null } }));
  await page.route("**/api/matches/decisions", route => route.fulfill({ json: { decisions: [{ id: "decision", choice: "ACCEPT",
    createdAt: "2026-11-25T00:00:00.000Z", available: true, mutual: true, connectionId: "synthetic-connection" }], nextCursor: null } }));
  await page.goto("http://127.0.0.1:3101/matches");
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("link", { name: "View profile and chat" })).toHaveAttribute("href", "/account/matches/synthetic-connection");
});
test("sharing starts off and saves only explicit choices", async ({ page }) => {
  let data = blank();
  await page.route(endpoint, route => route.fulfill({ json: data }));
  await page.route(endpoint + "/sharing", route => {
    expect(route.request().postDataJSON()).toEqual({ expectedRevision: 0, profileShared: true, contactShared: false, chatEnabled: true });
    data.sharing = { ...data.sharing, revision: 1, profileShared: true, chatEnabled: true };
    return route.fulfill({ json: { sharing: data.sharing } });
  });
  await page.goto("http://127.0.0.1:3101/match-connection");
  await expect(page.getByText("This person has not shared their profile with you yet.")).toBeVisible();
  for (const box of await page.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Share my profile" }).check();
  await page.getByRole("checkbox", { name: "Enable chat" }).check();
  await page.getByRole("button", { name: "Save sharing choices" }).click();
  await expect(page.getByText("Waiting for the other person to enable chat.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
});
test("reads the shared profile and conversation, sends plain text and clears content on denied refresh", async ({ page }) => {
  const data = blank(); let denied = false;
  data.sharing.chatEnabled = true; data.peer.chatEnabled = true; data.chatAvailable = true;
  data.peer.profile = { displayName: "Demo Peer", age: 28, city: "Hanoi", occupation: "Designer", bio: "I enjoy books.",
    relationshipGoal: "long-term", interests: ["books"], values: ["respect"], photo: null };
  data.peer.contactEmail = "peer@example.invalid";
  const messages = [{ id: "msg1", clientMessageId: null as string | null, sender: "peer", text: "Hello!", createdAt: "2026-11-25T00:00:00.000Z" }];
  await page.route(endpoint, route => route.fulfill(denied ? { status: 404, json: { code: "MATCH_UNAVAILABLE" } } : { json: data }));
  await page.route(endpoint + "/messages", route => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      expect(input.clientMessageId).toMatch(/^[a-f0-9-]{36}$/);
      expect(input.text).toBe("Nice to meet you.");
      const message = { id: "msg2", ...input, sender: "me", createdAt: "2026-11-25T00:00:01Z" };
      messages.push(message); return route.fulfill({ status: 201, json: { message } });
    }
    return route.fulfill({ json: { messages, nextCursor: null } });
  });
  await page.goto("http://127.0.0.1:3101/match-connection");
  await expect(page.getByRole("heading", { name: "Demo Peer, 28" })).toBeVisible();
  await expect(page.getByRole("link", { name: "peer@example.invalid" })).toHaveAttribute("href", "mailto:peer@example.invalid");
  await page.getByLabel("Message", { exact: true }).fill("Nice to meet you.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Nice to meet you.", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("match-connection.png"), fullPage: true });
  denied = true;
  await page.getByRole("button", { name: "Refresh connection" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("unavailable");
  await expect(page.getByText("Demo Peer, 28")).toHaveCount(0);
  await expect(page.getByText("Hello!", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "peer@example.invalid" })).toHaveCount(0);
});

test("failed delivery explains recovery and retries the same message after refresh", async ({ page }) => {
  const data = blank(); data.sharing.chatEnabled = true; data.peer.chatEnabled = true; data.chatAvailable = true;
  let attempt = 0; let original: unknown;
  await page.route(endpoint, route => route.fulfill({ json: data }));
  await page.route(endpoint + '/messages', route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { messages: [], nextCursor: null } });
    const input = route.request().postDataJSON();
    if (attempt++ === 0) { original = input; return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }); }
    expect(input).toEqual(original);
    return route.fulfill({ status: 201, json: { message: { id: 'msg-retry', ...input, sender: 'me', createdAt: '2026-11-25T00:00:01Z' } } });
  });
  await page.goto('http://127.0.0.1:3101/match-connection');
  await page.getByLabel('Message', { exact: true }).fill('Hello again.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('HTTP 503');
  await expect(page.locator('main').getByRole('alert')).toContainText('Delivery is not confirmed');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check connection again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry message', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry message', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Message sent.');
  expect(attempt).toBe(2);
});
