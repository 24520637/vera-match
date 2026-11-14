import { test, expect } from "@playwright/test";
test("same-origin health proxy reaches the real NestJS API", async ({
  request,
}) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    service: "vera-api",
    status: "ok",
    implementation: "scaffold",
  });
});

test("protected SSR rejects missing and forged cookies before serving member content", async ({
  request,
}) => {
  for (const cookie of ["", "vera_e2e_session=" + "a".repeat(43)]) {
    const response = await request.get("/account", {
      maxRedirects: 0,
      headers: cookie ? { Cookie: cookie } : {},
    });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/login?next=%2Faccount");
    expect(await response.text()).not.toContain("Your session is active.");
  }
});

test("same-origin proxy preserves server Origin checks before any cookie mutation", async ({
  request,
}) => {
  for (const origin of [undefined, "https://attacker.invalid"]) {
    const response = await request.post("/api/auth/logout", {
      headers: origin ? { Origin: origin } : {},
      data: {},
    });
    expect(response.status()).toBe(403);
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(await response.json()).toMatchObject({ code: "ORIGIN_DENIED" });
  }
});
