import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("file validation, local preview, keyboard and unavailable-camera fallback", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/video-upload");
  const input = page.getByLabel("Video file", { exact: false });
  await input.setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a video"),
  });
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "MP4 or WebM",
  );
  await input.setInputFiles({
    name: "synthetic.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
  });
  await expect(
    page.getByText("Local preview. This video has not been uploaded yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload private video" }),
  ).toBeEnabled();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    }),
  );
  const record = page.getByRole("button", { name: "Record a video" });
  await record.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Choose a video file instead",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("video")).toHaveAttribute("controls", "");
});
