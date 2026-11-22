// A new, task-owned Chromium profile. Never attach to a developer's browser.
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
async function createNativeVisibilityRuntime({ headless = false, viewport } = {}) {
  if (process.env.VERA_NATIVE_BACKGROUND_E2E !== "1" ||
      (!headless && (process.platform !== "linux" || !process.env.DISPLAY)))
    throw Error("Isolated native visibility test runtime required");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vera-native-tabs-"));
  const child = spawn(chromium.executablePath(), [
    ...(headless ? ["--headless=new"] : []), "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1", "--user-data-dir=" + directory, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let browser, launchFailed = false;
  child.on("error", () => { launchFailed = true; });
  const close = async () => {
    await browser?.close().catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    for (const until = Date.now() + 3000; child.exitCode === null && child.signalCode === null && Date.now() < until;)
      await new Promise(resolve => setTimeout(resolve, 50));
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    const target = await fs.realpath(directory), parent = await fs.realpath(os.tmpdir());
    if (path.dirname(target) !== parent || !path.basename(target).startsWith("vera-native-tabs-"))
      throw Error("Unknown browser profile cleanup refused");
    await fs.rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  };
  try {
    let port;
    for (const until = Date.now() + 10000; Date.now() < until;) {
      if (launchFailed || child.exitCode !== null || child.signalCode !== null) throw Error("Native browser launch unavailable");
      try {
        const candidate = (await fs.readFile(path.join(directory, "DevToolsActivePort"), "utf8")).split("\n")[0];
        if (/^\d+$/.test(candidate) && +candidate > 1023 && +candidate < 65536) { port = candidate; break; }
      } catch { /* Only this run's fresh profile is polled. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!port) throw Error("Owned browser endpoint unavailable");
    // Public API: unlike a normal Playwright context, this existing fresh default
    // context gets no forced focus/visibility override. No DOM property is mocked.
    browser = await chromium.connectOverCDP("http://127.0.0.1:" + port, { noDefaults: true });
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    if (viewport) await page.setViewportSize(viewport);
    return { context, page, close };
  } catch (error) { await close(); throw error; }
}
module.exports = { createNativeVisibilityRuntime };
