// Runtime calibration only: no database, app authorization or DOM visibility mock.
const { createNativeVisibilityRuntime } = require("../apps/web/tests/native-visibility-runtime.cjs");
async function check() {
  const runtime = await createNativeVisibilityRuntime({ headless: process.argv.includes("--headless") });
  try {
    const { context, page } = runtime;
    const requireState = async state => {
      for (const until = Date.now() + 5000; Date.now() < until;) {
        if (await page.evaluate(() => document.visibilityState) === state) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw Error("NATIVE_VISIBILITY_STATE_UNAVAILABLE_" + state.toUpperCase());
    };
    await page.bringToFront(); await requireState("visible");
    const other = await context.newPage();
    await other.bringToFront(); await requireState("hidden");
    await page.bringToFront(); await requireState("visible");
    console.log("PASS NATIVE_TAB_VISIBILITY_RUNTIME: visible -> hidden -> visible; no app traffic.");
  } finally { await runtime.close(); }
}
check().catch(error => { console.error(error.message); process.exitCode = 1; });
