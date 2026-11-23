const assert = require("node:assert/strict");
const test = require("node:test");
const { waitForFixtureListeners } = require("./wait-t20-fixture-listeners.cjs");

const pid = 4321;
const api = { address: "127.0.0.1", port: 9000, pid };
const consoleListener = { address: "127.0.0.1", port: 9001, pid };

function check(readListeners, options = {}) {
  return waitForFixtureListeners("minio", pid, {
    readListeners,
    checkProcess() {},
    checkHealth: async url => {
      assert.equal(url, "http://127.0.0.1:9000/minio/health/live");
      return true;
    },
    pollMs: 1,
    ...options,
  });
}

test("waits for the console listener even when the MinIO API is healthy", async () => {
  let snapshots = 0;
  const rows = await check(() => ++snapshots === 1 ? [api] : [api, consoleListener]);
  assert.equal(snapshots, 2);
  assert.deepEqual(rows, [api, consoleListener]);
});

test("times out if the expected console listener never appears", async () => {
  await assert.rejects(check(() => [api], { timeoutMs: 0 }),
    /minio readiness timeout.*9000, 9001.*healthy=true/);
});

test("refuses a console listener owned by a different PID", async () => {
  await assert.rejects(check(() => [api, { ...consoleListener, pid: pid + 1 }]),
    /minio listener ownership mismatch/);
});

test("refuses non-loopback listeners even if they have the expected PID", async () => {
  for (const address of ["0.0.0.0", "[::]", "192.0.2.1"]) {
    await assert.rejects(check(() => [api, { ...consoleListener, address }]),
      /minio listener ownership mismatch/);
  }
});
