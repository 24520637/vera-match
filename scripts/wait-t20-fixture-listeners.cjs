const { execFileSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const fixtures = new Map([
  ["mailpit", { ports: [1025, 8025], health: "http://127.0.0.1:8025/livez" }],
  ["minio", { ports: [9000, 9001], health: "http://127.0.0.1:9000/minio/health/live" }],
]);

function readWindowsListeners(timeout) {
  return execFileSync("netstat.exe", ["-ano"], { encoding: "utf8", windowsHide: true, timeout })
    .split(/\r?\n/).flatMap(line => {
      const match = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
      return match ? [{ address: match[1], port: Number(match[2]), pid: Number(match[3]) }] : [];
    });
}

function requireRunning(pid, fixture) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    throw new Error(`${fixture} PID ${pid} is not available: ${error.code ?? error.name}`);
  }
}

async function isHealthy(url, timeout) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    await response.body?.cancel();
    return response.status === 200;
  } catch {
    return false;
  }
}

async function waitForFixtureListeners(fixture, pid, {
  readListeners = readWindowsListeners,
  checkProcess = requireRunning,
  checkHealth = isHealthy,
  timeoutMs = 15000,
  pollMs = 100,
} = {}) {
  const service = fixtures.get(fixture);
  if (!service || !Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff)
    throw new Error("Usage: node scripts/wait-t20-fixture-listeners.cjs <mailpit|minio> <pid>");

  const healthPort = Number(new URL(service.health).port);
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  let observed = [];
  let healthy = false;
  do {
    checkProcess(pid, fixture);
    observed = readListeners(Math.min(5000, remaining())).filter(row => service.ports.includes(row.port));
    if (observed.some(row => row.pid !== pid || !["127.0.0.1", "[::1]"].includes(row.address)))
      throw new Error(`${fixture} listener ownership mismatch for PID ${pid}: ${JSON.stringify(observed)}`);
    const binds = port => observed.some(row => row.port === port && row.address === "127.0.0.1");
    healthy = binds(healthPort) &&
      await checkHealth(service.health, Math.min(1000, remaining()));
    // MinIO's API can be healthy before the console opens its listener.
    if (healthy && service.ports.every(binds)) {
      checkProcess(pid, fixture);
      return observed;
    }
    if (Date.now() < deadline) await delay(Math.min(pollMs, remaining()));
  } while (Date.now() < deadline);
  throw new Error(`${fixture} readiness timeout for PID ${pid} on ports ${service.ports.join(", ")}` +
    `; healthy=${healthy}; observed ${JSON.stringify(observed)}`);
}

if (require.main === module) {
  const [fixture, pid] = process.argv.slice(2);
  waitForFixtureListeners(fixture, Number(pid)).then(rows => {
    console.log(`${fixture} ready on loopback, PID ${pid}: ${JSON.stringify(rows)}`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { waitForFixtureListeners };
