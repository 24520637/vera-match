// Runtime calibration only: no database, app authorization or DOM visibility mock.
const { chromium } = require("playwright");
if (process.platform !== "linux" || !process.env.DISPLAY || process.env.VERA_NATIVE_BACKGROUND_E2E !== "1")
  throw Error("Isolated Linux/Xvfb native visibility runtime required");
async function check() {
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const native = async target => (await context.newCDPSession(target))
      .send("Emulation.setFocusEmulationEnabled", { enabled: false });
    const requireState = async state => {
      for (const until = Date.now() + 5000; Date.now() < until;) {
        if (await page.evaluate(() => document.visibilityState) === state) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw Error("NATIVE_VISIBILITY_STATE_UNAVAILABLE_" + state.toUpperCase());
    };
    // The installed Playwright driver explicitly enables focus emulation during
    // page initialization. Restore native browser behavior before measuring it.
    await native(page);
    await page.bringToFront(); await requireState("visible");
    const other = await context.newPage();
    await native(other); await other.bringToFront(); await requireState("hidden");
    await page.bringToFront(); await requireState("visible");
    console.log("PASS NATIVE_TAB_VISIBILITY_RUNTIME: visible -> hidden -> visible; no app traffic.");
  } finally { await browser.close(); }
}
check().catch(error => { console.error(error.message); process.exitCode = 1; });
