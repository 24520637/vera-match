// Disposable TLS termination only. Never imported by the application.
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const { join } = require("node:path");
if (process.env.NODE_ENV !== "test" || !/^[a-f0-9-]{36}$/.test(process.env.VERA_HTTPS_E2E_RUN_ID || "") ||
    process.env.VERA_HTTPS_E2E_RUN_ID !== process.env.VERA_AUTH_E2E_RUN_ID || !process.env.VERA_TLS_DIR)
  throw new Error("Isolated HTTPS fixture required");
const hosts = new Set(["vera.test", "sibling.vera.test", "foreign.test", "127.0.0.1"]);
function handle(secure) {
  return (request, response) => {
    const host = (request.headers.host || "").split(":")[0];
    if (!hosts.has(host)) { response.writeHead(400).end(); return; }
    if (request.url === "/__tls-probe") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ secure, cookieReceived: /(?:^|;\s*)vera_e2e_session=/.test(request.headers.cookie || "") }));
      return;
    }
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) =>
      !name.startsWith("x-forwarded-") && !["forwarded", "x-real-ip", "connection"].includes(name)));
    // The gateway replaces forwarding claims. Nest remains untrusted-proxy by default.
    Object.assign(headers, { "x-forwarded-for": request.socket.remoteAddress,
      "x-forwarded-proto": secure ? "https" : "http", "x-forwarded-host": request.headers.host });
    const upstream = http.request({ host: "127.0.0.1", port: 3140, method: request.method,
      path: request.url, headers }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream);
    request.on("aborted", () => upstream.destroy());
  };
}
const tls = https.createServer({ key: fs.readFileSync(join(process.env.VERA_TLS_DIR, "server.key")),
  cert: fs.readFileSync(join(process.env.VERA_TLS_DIR, "server.pem")), minVersion: "TLSv1.2" }, handle(true));
const plain = http.createServer(handle(false));
tls.listen(3443, "127.0.0.1");
plain.listen(3444, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  tls.close(); plain.close(); tls.closeAllConnections(); plain.closeAllConnections();
});
