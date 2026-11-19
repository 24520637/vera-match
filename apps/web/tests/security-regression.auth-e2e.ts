import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  readActivationEmail,
  clearTestEmails,
} from "../../api/test/mailpit-fixtures";

for (const remoteLogout of [false, true])
  test(
    "C084 real browser offline " +
      (remoteLogout
        ? "then remote revocation becomes 401"
        : "restores the original HttpOnly session"),
    async ({ page, context, browser }) => {
      const email = "security-browser-" + randomUUID() + "@example.invalid";
      const password = "synthetic-browser-security-password";
      const origin = "http://localhost:3100";
      const post = (path: string, data: object) =>
        context.request.post(origin + "/api/auth/" + path, {
          headers: { Origin: origin },
          data,
        });
      const other = await browser.newContext();
      try {
        expect(
          (
            await post("register", { email, password, declaredAdult: true })
          ).status(),
        ).toBe(202);
        const activation = await readActivationEmail(email);
        expect(
          (await post("verify-email", { token: activation.token })).status(),
        ).toBe(200);
        const login = await post("login", { email, password });
        expect(login.status()).toBe(200);
        const setCookie = login.headers()["set-cookie"];
        // Assert flags without printing the token if an assertion fails.
        expect(/;\s*HttpOnly/i.test(setCookie)).toBe(true);
        expect(/;\s*Path=\//i.test(setCookie)).toBe(true);
        expect(/;\s*Domain=/i.test(setCookie)).toBe(false);
        await page.goto("/account");
        await expect(page.getByText(email, { exact: true })).toBeVisible();
        const before = (await context.cookies()).find(
          (c) => c.name === "vera_e2e_session",
        )!;
        expect({
          httpOnly: before.httpOnly,
          secure: before.secure,
          path: before.path,
          sameSite: before.sameSite,
        }).toEqual({
          httpOnly: true,
          secure: false,
          path: "/",
          sameSite: "Lax",
        });
        expect(
          await page.evaluate(
            () =>
              document.cookie === "" &&
              localStorage.length === 0 &&
              sessionStorage.length === 0,
          ),
        ).toBe(true);
        if (remoteLogout)
          expect(
            (
              await other.request.post(origin + "/api/auth/login", {
                headers: { Origin: origin },
                data: { email, password },
              })
            ).status(),
          ).toBe(200);
        await context.setOffline(true);
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        // Refresh the real AuthProvider while Chromium networking is actually offline.
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(
          page.getByText("We could not check your session.", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText(email, { exact: true })).toHaveCount(0);
        await expect(page).toHaveURL("/account");
        expect(
          (await context.cookies()).find((c) => c.name === before.name)
            ?.value === before.value,
        ).toBe(true);
        if (remoteLogout)
          expect(
            (
              await other.request.post(origin + "/api/auth/logout-all", {
                headers: { Origin: origin },
                data: {},
              })
            ).status(),
          ).toBe(204);
        await context.setOffline(false);
        if (remoteLogout) {
          await expect(page).toHaveURL(/\/login/);
          expect(
            (await context.request.get(origin + "/api/auth/me")).status(),
          ).toBe(401);
        } else {
          await expect(page.getByText(email, { exact: true })).toBeVisible();
          expect(
            (await context.request.get(origin + "/api/auth/me")).status(),
          ).toBe(200);
          expect(
            (await context.cookies()).find((c) => c.name === before.name)
              ?.value === before.value,
          ).toBe(true);
        }
      } finally {
        await context.setOffline(false);
        await other.close();
        await clearTestEmails(email);
      }
    },
  );
