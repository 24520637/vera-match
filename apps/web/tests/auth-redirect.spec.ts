import { expect, test } from "@playwright/test";
import { safeNextPath } from "../src/lib/auth-redirect";
import { readRememberedEmail, rememberEmail } from "../src/lib/remember-email";

test("only implemented internal destinations can follow sign-in", () => {
  for (const target of [
    "https://attacker.invalid",
    "//attacker.invalid",
    "/\\attacker.invalid",
    "/%2f%2fattacker.invalid",
    "/login?next=/login",
    "javascript:alert(1)",
    undefined,
    ["/account"],
    "/account\nLocation: https://attacker.invalid",
  ])
    expect(safeNextPath(target)).toBe("/account");
  expect(safeNextPath("/account")).toBe("/account");
  expect(safeNextPath("/account?section=security#sessions")).toBe(
    "/account?section=security#sessions",
  );
});
test("remember-email uses one explicit email-only key and supports withdrawal or blocked storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  expect(readRememberedEmail(storage).email).toBe("");
  rememberEmail(storage, "Synthetic@Example.Invalid", false);
  expect(values.size).toBe(0);
  rememberEmail(storage, "Synthetic@Example.Invalid", true);
  expect([...values.entries()]).toEqual([
    ["vera.rememberedEmail", "synthetic@example.invalid"],
  ]);
  expect(readRememberedEmail(storage).email).toBe("synthetic@example.invalid");
  rememberEmail(storage, "", false);
  expect(values.size).toBe(0);
  expect(
    readRememberedEmail({
      ...storage,
      getItem: () => {
        throw new Error("Storage blocked");
      },
    }).available,
  ).toBe(false);
});
