// Isolated synthetic test host. Never imported by the production application.
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
Object.assign(process.env, {
  API_PORT: "4100",
  APP_BASE_URL: "http://localhost:3100",
  CORS_ORIGIN: "http://localhost:3100",
  COOKIE_SECURE: "false",
  COOKIE_SAME_SITE: "lax",
  SESSION_COOKIE_NAME: "vera_e2e_session",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_SECURE: "false",
  SMTP_REQUIRE_TLS: "false",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
});
const { PrismaClient } = require("@prisma/client");
const {
  S3Client,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteBucketCommand,
  PutBucketLifecycleConfigurationCommand,
} = require("@aws-sdk/client-s3");
const schema = `vera_auth_test_${randomUUID().replaceAll("-", "")}`;
const bucket = `vera-video-e2e-${randomUUID()}`;
const runId = process.env.VERA_VIDEO_E2E_RUN_ID;
const metadata = resolve(root, "apps/web/.video-e2e-runtime.json");
let admin,
  storage,
  app,
  timer,
  schemaCreated = false,
  bucketCreated = false;
async function cleanup() {
  clearInterval(timer);
  await app?.close();
  if (bucketCreated) {
    const list = await storage.send(
      new ListObjectsV2Command({ Bucket: bucket }),
    );
    for (const item of list.Contents || [])
      await storage.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: item.Key }),
      );
    await storage.send(new DeleteBucketCommand({ Bucket: bucket }));
    bucketCreated = false;
  }
  storage?.destroy();
  if (schemaCreated) {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    schemaCreated = false;
  }
  await admin?.$disconnect();
  if (
    fs.existsSync(metadata) &&
    JSON.parse(fs.readFileSync(metadata, "utf8")).runId === runId
  )
    fs.unlinkSync(metadata);
}
(async () => {
  if (!/^[a-f0-9-]{36}$/.test(runId || ""))
    throw Error("Test run identifier required");
  const url = new URL(process.env.DATABASE_URL || "");
  const endpoint = new URL(
    process.env.MINIO_ENDPOINT || "http://localhost:9000",
  );
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== "5433" ||
    !["localhost", "127.0.0.1"].includes(endpoint.hostname) ||
    endpoint.port !== "9000" ||
    fs.existsSync(metadata)
  )
    throw Error("Isolated local services required");
  admin = new PrismaClient({ log: [] });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
  process.env.MINIO_BUCKET = bucket;
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
  storage = new S3Client({
    endpoint: endpoint.origin,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ROOT_USER,
      secretAccessKey: process.env.MINIO_ROOT_PASSWORD,
    },
  });
  await storage.send(new CreateBucketCommand({ Bucket: bucket }));
  bucketCreated = true;
  await storage.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "expire-incoming",
            Status: "Enabled",
            Filter: { Prefix: "incoming/" },
            Expiration: { Days: 1 },
          },
        ],
      },
    }),
  );
  const { Test } = require("@nestjs/testing");
  const { AppModule } = require(resolve(root, "apps/api/dist/app.module.js"));
  const { ConsentPolicyRegistry } = require(
    resolve(root, "apps/api/dist/consent/consent.policy.js"),
  );
  const { VideoCleanupService } = require(
    resolve(root, "apps/api/dist/video/video-cleanup.service.js"),
  );
  const { ExpertApprovalRegistry, ExpertEvidenceSource } = require(
    resolve(root, "apps/api/dist/expert-admin/expert-approval.sources.js"),
  );
  const { ExpertMfaSource } = require(
    resolve(root, "apps/api/dist/expert-admin/expert-mfa.source.js"),
  );
  const { StaffAssuranceSource } = require(
    resolve(root, "apps/api/dist/safety/staff-assurance.source.js"),
  );
  const { PrismaService } = require(resolve(root, "apps/api/dist/database/prisma.service.js"));
  const { configureApplication } = require(
    resolve(root, "apps/api/dist/configure-app.js"),
  );
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConsentPolicyRegistry)
    .useValue({
      current(purpose) {
        return {
          purpose,
          policyVersion: "synthetic-video-e2e-v1",
          locale: "en-test",
          testOnly: true,
          content: `TEST ONLY - NOT A LEGAL POLICY - ${purpose}`,
        };
      },
    })
    .overrideProvider(ExpertApprovalRegistry)
    .useValue({
      training: version => version === "t08-fixture-training" ? { version, content: "Synthetic T08 training" } : undefined,
      confidentiality: version => version === "t08-fixture-confidentiality" ? { version, content: "Synthetic T08 confidentiality" } : undefined,
    })
    .overrideProvider(ExpertEvidenceSource)
    .useValue({
      async find(id) {
        const match = /^t08-(training|confidentiality)-([a-z0-9]{20,40})$/.exec(id);
        if (!match) return undefined;
        const user = await app.get(PrismaService).user.findUnique({
          where: { id: match[2] }, select: { role: true, email: true },
        });
        if (user?.role !== "EXPERT" || !user.email.endsWith("@t08.example.invalid")) return undefined;
        const training = match[1] === "training";
        return { id, userId: match[2], version: `t08-fixture-${match[1]}`,
          kind: training ? "TRAINING_COMPLETION" : "CONFIDENTIALITY_ACCEPTANCE",
          content: "Synthetic T08 evidence", recordedAt: new Date(0), validUntil: null };
      },
    })
    .overrideProvider(ExpertMfaSource)
    .useValue({
      async resolve(auth, tx) {
        const session = await tx.session.findUnique({ where: { id: auth.sessionId }, include: { user: true } });
        if (session?.userId !== auth.user.id || !session.user.email.endsWith("@t08.example.invalid")) return undefined;
        return { userId: session.userId, sessionId: session.id, expiresAt: session.expiresAt, testOnly: true };
      },
    })
    .overrideProvider(StaffAssuranceSource)
    .useValue({
      async resolve(tx, auth) {
        const session = await tx.session.findUnique({ where: { id: auth.sessionId }, include: { user: true } });
        if (session?.userId !== auth.user.id || session.user.role !== "MODERATOR" ||
          !session.user.email.endsWith("@t16-qa.example.invalid")) return undefined;
        return {
          userId: session.userId, sessionId: session.id, level: "MFA",
          verifiedAt: session.createdAt, expiresAt: session.expiresAt, testOnly: true,
        };
      },
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.listen(4100, "127.0.0.1");
  timer = setInterval(() => {
    void app
      .get(VideoCleanupService)
      .runOnce()
      .catch(() => undefined);
  }, 500);
  fs.writeFileSync(
    metadata,
    JSON.stringify({ kind: "vera-video-e2e-v1", runId, schema, bucket }),
    { flag: "wx" },
  );
  console.log("Synthetic private-video API ready on localhost:4100");
})().catch(async () => {
  console.error("Private video E2E setup failed; check local test services.");
  await cleanup().catch(() => undefined);
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(0));
  });
