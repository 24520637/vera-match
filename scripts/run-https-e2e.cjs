const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID, X509Certificate } = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
for (const file of ["apps/api/.env", ".env"]) {
  try { process.loadEnvFile(path.join(root, file)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const id = randomUUID();
const env = { ...process.env, NODE_ENV: "test", VERA_HTTPS_E2E_RUN_ID: id,
  VERA_AUTH_E2E_RUN_ID: id, API_INTERNAL_ORIGIN: "http://127.0.0.1:4140" };
const node = (file, args, cwd, extra = {}) => execFileSync(process.execPath,
  [path.join(root, file), ...args], { cwd: path.join(root, cwd), env: { ...env, ...extra },
    windowsHide: true, stdio: "inherit", timeout: 180000 });
function command(file, args) {
  try { execFileSync(file, args, { windowsHide: true, stdio: "pipe", timeout: 30000 }); }
  catch (error) { throw new Error("TLS tooling step " + args[0] + " failed (" + (error.code || error.status || "unknown") + ")"); }
}
async function main() {
  const database = new URL(env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.port !== "5433")
    throw new Error("Local PostgreSQL test database required");
  node("node_modules/@nestjs/cli/bin/nest.js", ["build"], "apps/api");
  node("node_modules/next/dist/bin/next", ["build"], "apps/web", { NODE_ENV: "production" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vera-https-"));
  const openssl = process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "/usr/bin/openssl";
  const ca = path.join(dir, "ca.pem");
  const home = path.join(dir, "browser-home");
  let trusted = false, thumbprint;
  const certutil = path.join(process.env.SystemRoot || "C:/Windows", "System32/certutil.exe");
  try {
    command(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
      "-subj", "/CN=VERA disposable HTTPS " + id, "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-keyout", path.join(dir, "ca.key"), "-out", ca]);
    command(openssl, ["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=vera.test",
      "-keyout", path.join(dir, "server.key"), "-out", path.join(dir, "server.csr")]);
    fs.writeFileSync(path.join(dir, "extensions"), "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:vera.test,DNS:sibling.vera.test,DNS:foreign.test,IP:127.0.0.1\n");
    command(openssl, ["x509", "-req", "-in", path.join(dir, "server.csr"), "-CA", ca,
      "-CAkey", path.join(dir, "ca.key"), "-CAcreateserial", "-days", "1", "-extfile", path.join(dir, "extensions"),
      "-out", path.join(dir, "server.pem")]);
    for (const key of ["ca.key", "server.key"]) fs.chmodSync(path.join(dir, key), 0o600);
    if (process.platform === "win32") {
      thumbprint = new X509Certificate(fs.readFileSync(ca)).fingerprint.replaceAll(":", "");
      fs.writeFileSync(path.join(dir, "trust-recovery.json"), JSON.stringify({ kind: "vera-disposable-tls", thumbprint }));
      trusted = true;
      command(certutil, ["-Silent", "-f", "-user", "-addstore", "Root", ca]);
    } else {
      const db = path.join(home, ".pki/nssdb");
      fs.mkdirSync(db, { recursive: true });
      command("certutil", ["-N", "--empty-password", "-d", "sql:" + db]);
      command("certutil", ["-A", "-d", "sql:" + db, "-n", "VERA disposable " + id, "-t", "C,,", "-i", ca]);
    }
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, "node_modules/playwright/cli.js"), "test",
        "--config", "playwright.https.config.ts", ...process.argv.slice(2)], {
        cwd: path.join(root, "apps/web"), windowsHide: true, stdio: "inherit",
        env: { ...env, NODE_EXTRA_CA_CERTS: ca, VERA_TLS_DIR: dir, VERA_TLS_BROWSER_HOME: home } });
      const stop = () => child.kill("SIGINT");
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      child.once("error", reject);
      child.once("exit", code => {
        process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); resolve(code ?? 1);
      });
    });
    if (status !== 0) process.exitCode = status;
  } finally {
    // Remove only the CA minted by this run, never an existing user certificate.
    if (trusted) {
      let present = false;
      try { execFileSync(certutil, ["-user", "-store", "Root", thumbprint], { windowsHide: true, stdio: "pipe", timeout: 10000 }); present = true; }
      catch (error) { if (!error.status) throw new Error("Unable to inspect owned test CA; use trust-recovery.json for cleanup"); }
      if (present) command(certutil, ["-user", "-delstore", "Root", thumbprint]);
    }
    const target = fs.realpathSync(dir), parent = fs.realpathSync(os.tmpdir());
    if (path.dirname(target) !== parent || !path.basename(target).startsWith("vera-https-"))
      throw new Error("Refusing cleanup outside the owned TLS temporary directory");
    fs.rmSync(target, { recursive: true, force: true });
  }
}
main().catch(error => { console.error("HTTPS regression runner failed: " + (error.message.startsWith("TLS tooling step") ? error.message : "setup/runtime unavailable") + "; no production acceptance is claimed."); process.exitCode = 1; });
