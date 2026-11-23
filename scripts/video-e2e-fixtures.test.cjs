const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, rmdir, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { cleanupVideoFixture, fixtureEndpoints, verifyBucketWritable } = require("./video-e2e-fixtures.cjs");

const env = {
  VERA_VIDEO_E2E_RUN_ID: "5997148e-b016-4b27-9f08-c45f30f7d092",
  DATABASE_URL: "postgresql://fixture@127.0.0.1:5433/fixture",
  MINIO_ENDPOINT: "http://127.0.0.1:9000",
};
const manifest = {
  kind: "vera-video-e2e-v1",
  runId: env.VERA_VIDEO_E2E_RUN_ID,
  schema: "vera_auth_test_0123456789abcdef0123456789abcdef",
  bucket: "vera-video-e2e-5997148e-b016-4b27-9f08-c45f30f7d092",
};

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "vera-video-cleanup-"));
  const file = join(dir, "owned.json");
  t.after(async () => {
    await rm(file, { force: true });
    await rmdir(dir);
  });
  await writeFile(file, JSON.stringify(manifest));
  return file;
}

test("cleans the schema even if MinIO fails, retains ownership, and permits a retry", async t => {
  const file = await fixture(t);
  let schemaAttempts = 0;
  const removeSchema = async name => {
    assert.equal(name, manifest.schema);
    schemaAttempts++;
  };
  await assert.rejects(cleanupVideoFixture(env, {
    file, removeSchema, removeBucket: async () => { throw new Error("fixture outage"); },
  }), /retained the runtime manifest/);
  assert.equal(schemaAttempts, 1);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), manifest);
  await cleanupVideoFixture(env, {
    file, removeSchema, removeBucket: async name => assert.equal(name, manifest.bucket),
  });
  assert.equal(schemaAttempts, 2);
  await assert.rejects(readFile(file), { code: "ENOENT" });
});

test("does not touch resources named by another invocation", async t => {
  const file = await fixture(t);
  const unreachable = () => assert.fail("unowned resources must not be touched");
  await assert.rejects(cleanupVideoFixture({ ...env, VERA_VIDEO_E2E_RUN_ID: "" }, {
    file, removeSchema: unreachable, removeBucket: unreachable,
  }), /refusing cleanup/);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), manifest);
});

test("refuses non-loopback or wrong-protocol services", () => {
  assert.throws(() => fixtureEndpoints({ ...env, MINIO_ENDPOINT: "http://storage.invalid:9000" }), /Isolated local/);
  assert.throws(() => fixtureEndpoints({ ...env, DATABASE_URL: "http://127.0.0.1:5433/fixture" }), /Isolated local/);
});

test("checks writes in the owned bucket and reports a sanitized MinIO refusal", async () => {
  const success = { send: async (command, options) => {
    assert.equal(command.constructor.name, "PutObjectCommand");
    assert.equal(command.input.Bucket, manifest.bucket);
    assert.equal(command.input.Key, "fixture-write-probe");
    assert.ok(Buffer.isBuffer(command.input.Body));
    assert.ok(options.abortSignal instanceof AbortSignal);
  } };
  assert.deepEqual(await verifyBucketWritable(success, manifest.bucket), { writable: true });
  const failure = { send: async () => {
    throw Object.assign(new Error("provider diagnostic must not surface"), {
      name: "XMinioStorageFull", $metadata: { httpStatusCode: 507 },
    });
  } };
  assert.deepEqual(await verifyBucketWritable(failure, manifest.bucket), {
    writable: false, detail: "HTTP 507, XMinioStorageFull",
  });
});
