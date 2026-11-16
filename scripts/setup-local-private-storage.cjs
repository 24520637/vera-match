// Native loopback MinIO only. Reads machine-local secrets; prints no credentials.
const { resolve } = require("node:path");
const {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  GetBucketVersioningCommand,
  GetBucketPolicyCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
} = require("@aws-sdk/client-s3");
for (const file of ["apps/api/.env", ".env"]) {
  try {
    process.loadEnvFile(resolve(__dirname, "..", file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function main() {
  const endpoint = new URL(
    process.env.MINIO_ENDPOINT || "http://localhost:9000",
  );
  if (
    !["localhost", "127.0.0.1"].includes(endpoint.hostname) ||
    endpoint.port !== "9000"
  )
    throw Error("Native loopback MinIO required");
  const bucket = process.env.MINIO_BUCKET || "vera-private";
  const client = new S3Client({
    endpoint: endpoint.origin,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ROOT_USER,
      secretAccessKey: process.env.MINIO_ROOT_PASSWORD,
    },
  });
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (error.$metadata?.httpStatusCode !== 404) throw error;
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    if (
      (await client.send(new GetBucketVersioningCommand({ Bucket: bucket })))
        .Status
    )
      throw Error("Versioned bucket not supported");
    let noPolicy = false;
    try {
      await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
    } catch (error) {
      if (error.name !== "NoSuchBucketPolicy") throw error;
      noPolicy = true;
    }
    if (!noPolicy)
      throw Error("Refusing to modify a bucket with an existing policy");
    let rules = [];
    try {
      rules =
        (
          await client.send(
            new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
          )
        ).Rules || [];
    } catch (error) {
      if (error.name !== "NoSuchLifecycleConfiguration") throw error;
    }
    const existing = rules.find((rule) => rule.ID === "expire-incoming");
    if (
      existing &&
      !(
        existing.Status === "Enabled" &&
        existing.Filter?.Prefix === "incoming/" &&
        existing.Expiration?.Days === 1
      )
    )
      throw Error("Existing incoming lifecycle requires review");
    if (!existing)
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: bucket,
          LifecycleConfiguration: {
            Rules: [
              ...rules,
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
    console.log(
      "Local private bucket verified; incoming upload expiry configured.",
    );
  } finally {
    client.destroy();
  }
}
main().catch(() => {
  console.error(
    "Local storage setup failed; inspect private bucket configuration and service availability.",
  );
  process.exitCode = 1;
});
