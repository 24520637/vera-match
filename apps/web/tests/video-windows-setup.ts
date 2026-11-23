import { spawn } from "node:child_process";
import { connect } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(__dirname, "../../..");

function checkPort(host: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port });
    socket.setTimeout(1500, () => socket.destroy(new Error("Port check timed out")));
    socket.once("connect", () => socket.destroy(new Error(`Video E2E port ${host}:${port} is already in use`)));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (["ECONNREFUSED", "EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code ?? "")) resolve();
      else reject(error);
    });
  });
}

async function beforeDeadline<T>(operation: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function startServer(name: string, args: string[], cwd: string, ready: RegExp, ipc = false) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit", ipc ? "ipc" : "ignore"],
    windowsHide: true,
  });
  const output = createInterface({ input: child.stdout! });
  const exited = new Promise<number | null>(resolve => {
    child.once("exit", resolve);
    child.once("error", () => resolve(null));
  });
  const listening = new Promise<void>(resolve => {
    output.on("line", line => {
      console.log(`[${name}] ${line}`);
      if (ready.test(line)) resolve();
    });
  });
  return {
    child,
    async wait() {
      await beforeDeadline(Promise.race([
        listening,
        exited.then(code => { throw new Error(`${name} exited before readiness (code ${code})`); }),
      ]), 120_000, `${name} readiness timed out`);
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`${name} exited during readiness`);
      console.log(`[${name}] owned PID ${child.pid} ready`);
    },
    async stop() {
      try {
        if (child.connected) {
          child.send("shutdown", () => {});
          const code = await beforeDeadline(exited, 15_000, `${name} graceful shutdown timed out`);
          if (code !== 0) throw new Error(`${name} cleanup failed (code ${code})`);
        }
      } finally {
        child.kill();
        await beforeDeadline(exited, 5_000, `${name} did not exit`);
        output.close();
        console.log(`[${name}] owned PID ${child.pid} exited`);
      }
    },
  };
}

export default async function setup() {
  // Playwright's Windows webServer uses taskkill on a shell tree. Manage only
  // the direct Node children here so teardown can wait on their own handles.
  await Promise.all([3100, 4100].flatMap(port => [checkPort("127.0.0.1", port), checkPort("::1", port)]));
  const servers: ReturnType<typeof startServer>[] = [];
  const onExit = () => { for (const server of servers) server.child.kill(); };
  process.once("exit", onExit);
  const stop = async () => {
    const results = await Promise.allSettled(servers.map(server => server.stop()));
    process.removeListener("exit", onExit);
    const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Windows video server cleanup failed");
  };
  try {
    const web = startServer("video-web", [
      resolve(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "localhost", "--port", "3100",
    ], resolve(root, "apps/web"), /Ready in /);
    servers.push(web);
    await web.wait();
    const api = startServer("video-api", [resolve(root, "scripts/video-e2e-server.cjs")],
      root, /Synthetic private-video API ready/, true);
    servers.push(api);
    await api.wait();
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}
