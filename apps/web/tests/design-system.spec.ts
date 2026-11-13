import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public page is responsive and honest about product availability", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A meaningful connection starts with you.",
  );
  await expect(
    page.getByText("Private video reviews and matching are still taking shape.", { exact: false }),
  ).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("skip link and mobile navigation support keyboard and Escape", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: /^(Menu|Close menu)$/ });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("link", { name: "Our approach", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole("link", { name: "Design preview", exact: true }).click();
  await expect(page).toHaveURL("/design-system");
  await expect(
    page.getByRole("button", { name: "Menu", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("authentication validation links errors, focuses first error and sends no credentials", async ({
  page,
}) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
      mutations.push(request.url());
  });
  await page.goto("/design-system");
  const form = page.getByRole("form", { name: "Authentication example" });
  await form.getByRole("button", { name: "Check example form" }).click();
  const email = form.getByLabel("Email address");
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAccessibleDescription(
    "Enter an email address, such as hello@example.com.",
  );
  await email.fill("hello@example.com");
  await form.getByLabel("Password", { exact: false }).fill("example-password");
  await form.getByRole("button", { name: "Check example form" }).click();
  await expect(form.getByRole("status")).toContainText(
    "No sign-in request was sent",
  );
  await expect(email).not.toHaveAttribute("aria-invalid", "true");
  expect(mutations).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
});

test("profile consent starts off; reset confirms, traps focus and restores it", async ({
  page,
}) => {
  await page.goto("/design-system");
  const form = page.getByRole("form", { name: "Profile example" });
  for (const checkbox of await form.getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked();
  await form.getByRole("button", { name: "Preview profile" }).click();
  await expect(form.getByLabel("Display name")).toBeFocused();
  await form.getByLabel("Display name").fill("Example member");
  await form.getByLabel("Relationship intention").selectOption("long-term");
  await form.getByLabel("Use this profile for matching").check();
  const reset = form.getByRole("button", { name: "Reset example" });
  await reset.click();
  const dialog = page.getByRole("dialog", { name: "Reset this example?" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep editing" }),
  ).toBeFocused();
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(reset).toBeFocused();
  await expect(form.getByLabel("Display name")).toHaveValue("Example member");
  await reset.click();
  await dialog.getByRole("button", { name: "Reset example" }).click();
  await expect(form.getByLabel("Display name")).toHaveValue("");
  await expect(
    form.getByLabel("Use this profile for matching"),
  ).not.toBeChecked();
  await expect(reset).toBeFocused();
});

test("unsaved profile changes guard route navigation and successful preview is page-local", async ({
  page,
}) => {
  await page.goto("/design-system");
  const form = page.getByRole("form", { name: "Profile example" });
  await form.getByLabel("Display name").fill("Example member");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "VERA Match home" }).click();
  await expect(page).toHaveURL("/design-system");
  await expect(form.getByLabel("Display name")).toHaveValue("Example member");
  await form.getByLabel("Relationship intention").selectOption("long-term");
  await form.getByRole("button", { name: "Preview profile" }).click();
  await expect(form.getByRole("status")).toContainText(
    "Nothing was saved to an account",
  );
  await page.reload();
  await expect(
    page
      .getByRole("form", { name: "Profile example" })
      .getByLabel("Display name"),
  ).toHaveValue("");
});

test("review access and loading controls remain disabled and modal can be dismissed", async ({
  page,
}) => {
  await page.goto("/design-system");
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toHaveAttribute("aria-busy", "true");
  await expect(
    page.getByRole("button", { name: "Save observation" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Approve review" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Approve review" }),
  ).toHaveAccessibleDescription(/cannot approve their own/);
  expect(await page.locator("video").count()).toBe(0);
  const trigger = page.getByRole("button", {
    name: "Explore sharing controls",
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "You decide what is shared",
  });
  for (const checkbox of await dialog.getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("WCAG automated audit on public page, full component page and open modal", async ({
  page,
}) => {
  for (const route of ["/", "/design-system"]) {
    await page.goto(route);
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
  await page.getByRole("button", { name: "Explore sharing controls" }).click();
  const modalAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(modalAudit.violations).toEqual([]);
});

test("component page wraps at 320px and respects reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design-system");
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const button = page.getByRole("button", { name: "Check example form" });
  expect(
    await button.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe("0s");
  await page.getByRole("button", { name: "Explore sharing controls" }).click();
  const dialog = page.getByRole("dialog");
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});
