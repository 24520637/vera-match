// Starts only the installed native Windows MinIO, without placing secrets in argv.
const { resolve, join } = require("node:path");
const { existsSync, openSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
for (const file of ["apps/api/.env", ".env"]) {
  try {
    process.loadEnvFile(resolve(__dirname, "..", file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function start() {
  if (process.platform !== "win32")
    throw Error("This helper requires native Windows MinIO");
  const endpoint = new URL(
    process.env.MINIO_ENDPOINT || "http://localhost:9000",
  );
  if (
    !["localhost", "127.0.0.1"].includes(endpoint.hostname) ||
    endpoint.port !== "9000"
  )
    throw Error("Loopback MinIO required");
  try {
    if (
      (
        await fetch("http://127.0.0.1:9000/minio/health/live", {
          signal: AbortSignal.timeout(1000),
        })
      ).ok
    ) {
      console.log("Native MinIO is already running.");
      return;
    }
  } catch {}
  const home = process.env.MINIO_NATIVE_HOME || "C:/DevTools/MinIO";
  const binary = join(home, "minio.exe");
  if (
    !existsSync(binary) ||
    !process.env.MINIO_ROOT_USER ||
    !process.env.MINIO_ROOT_PASSWORD
  )
    throw Error("Installed binary and local credentials required");
  const log = openSync(join(home, "server.log"), "a");
  const child = spawn(
    binary,
    [
      "server",
      join(home, "data"),
      "--address",
      "127.0.0.1:9000",
      "--console-address",
      "127.0.0.1:9001",
      "--quiet",
    ],
    {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
        USERPROFILE: process.env.USERPROFILE,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        MINIO_ROOT_USER: process.env.MINIO_ROOT_USER,
        MINIO_ROOT_PASSWORD: process.env.MINIO_ROOT_PASSWORD,
        MINIO_API_CORS_ALLOW_ORIGIN: [
          process.env.CORS_ORIGIN || "http://localhost:3000",
          "http://localhost:3100",
          "http://127.0.0.1:3100",
        ].join(","),
      },
    },
  );
  child.on("error", () => {
    console.error("Native MinIO could not start.");
    process.exitCode = 1;
  });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      if (
        (
          await fetch("http://127.0.0.1:9000/minio/health/live", {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        console.log(
          "Native MinIO is ready on loopback ports 9000/9001. Run the local storage setup helper to verify the bucket.",
        );
        return;
      }
    } catch {}
    await delay(500);
  }
  throw Error("Native MinIO did not become ready");
}
start().catch(() => {
  console.error(
    "Native MinIO startup failed. Check its installation and ignored local configuration.",
  );
  process.exitCode = 1;
});
