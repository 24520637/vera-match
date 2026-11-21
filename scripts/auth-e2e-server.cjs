const { resolve } = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = resolve(__dirname, "..");
process.env.NODE_ENV = "test";
for (const file of ["apps/api/.env", ".env"]) {
  try {
    process.loadEnvFile(resolve(root, file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const httpsRun = process.env.VERA_HTTPS_E2E_RUN_ID;
if (httpsRun && (httpsRun !== process.env.VERA_AUTH_E2E_RUN_ID || !/^[a-f0-9-]{36}$/.test(httpsRun)))
  throw new Error("Isolated HTTPS runner required");
Object.assign(process.env, {
  API_PORT: httpsRun ? "4140" : "4100",
  APP_BASE_URL: httpsRun ? "https://vera.test:3443" : "http://localhost:3100",
  CORS_ORIGIN: httpsRun ? "https://vera.test:3443" : "http://localhost:3100",
  COOKIE_SECURE: httpsRun ? "true" : "false",
  COOKIE_SAME_SITE: "lax",
  SESSION_COOKIE_NAME: "vera_e2e_session",
});
process.env.MINIO_ROOT_USER ||= "synthetic-e2e";
process.env.MINIO_ROOT_PASSWORD ||= "synthetic-e2e-only";
const { PrismaClient } = require("@prisma/client");
let admin;
let schemaCreated = false;
const schema = `vera_auth_test_${randomUUID().replaceAll("-", "")}`;
const metadata = resolve(root, "apps/web/.auth-e2e-runtime.json");
let app;
const runId = process.env.VERA_AUTH_E2E_RUN_ID;
async function cleanup() {
  await app?.close();
  if (!/^vera_auth_test_[a-f0-9]{32}$/.test(schema))
    throw new Error("Unsafe fixture cleanup");
  if (schemaCreated) {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    schemaCreated = false;
  }
  await admin?.$disconnect();
  if (
    fs.existsSync(metadata) &&
    JSON.parse(fs.readFileSync(metadata, "utf8")).schema === schema
  )
    fs.unlinkSync(metadata);
}
(async () => {
  if (!/^[a-f0-9-]{36}$/.test(runId ?? ""))
    throw new Error("Authentication test runner ID required");
  const url = new URL(process.env.DATABASE_URL);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== "5433"
  )
    throw new Error("Local PostgreSQL test database required");
  if (fs.existsSync(metadata))
    throw new Error("Previous auth test runtime metadata requires inspection");
  admin = new PrismaClient({ log: [] });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
  execFileSync(
    process.execPath,
    [
      resolve(root, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      resolve(root, "apps/api/prisma/schema.prisma"),
    ],
    { env: process.env, stdio: "pipe", windowsHide: true },
  );
  fs.writeFileSync(
    metadata,
    JSON.stringify({ kind: "vera-auth-e2e-v1", schema, runId }),
    { flag: "wx" },
  );
  const { NestFactory } = require("@nestjs/core");
  const { AppModule } = require(resolve(root, "apps/api/dist/app.module.js"));
  const { configureApplication } = require(
    resolve(root, "apps/api/dist/configure-app.js"),
  );
  if (process.env.VERA_SAFETY_E2E_RUN_ID) {
    if (
      process.env.VERA_SAFETY_E2E_RUN_ID !== runId ||
      process.env.NODE_ENV !== "test" ||
      url.searchParams.get("schema") !== schema
    )
      throw new Error("Isolated safety fixture required");
    const { Test } = require("@nestjs/testing");
    const { StaffAssuranceSource } = require(
      resolve(root, "apps/api/dist/safety/staff-assurance.source.js"),
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StaffAssuranceSource)
      .useValue({
        resolve: async (tx, auth) => {
          const actor = await tx.user.findUnique({
            where: { id: auth.user.id },
            select: { email: true, role: true },
          });
          if (
            !actor ||
            actor.role !== "MODERATOR" ||
            !/^safety-staff-[a-f0-9-]+@example\.invalid$/.test(actor.email)
          )
            return undefined;
          return {
            userId: auth.user.id,
            sessionId: auth.sessionId,
            level: "MFA",
            verifiedAt: new Date(Date.now() - 1000),
            expiresAt: new Date(Date.now() + 60000),
            testOnly: true,
          };
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
  } else {
    app = await NestFactory.create(AppModule, { logger: false });
  }
  configureApplication(app);
  await app.listen(httpsRun ? 4140 : 4100, "127.0.0.1");
  console.log("Isolated authentication E2E API ready");
})().catch(async () => {
  console.error(
    "Authentication E2E setup failed; check local PostgreSQL/Mailpit and test runtime metadata.",
  );
  await cleanup().catch(() => undefined);
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(0));
  });
