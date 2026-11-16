import {
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";
export function configureIncomingExpiry(client: S3Client, bucket: string) {
  return client.send(
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
}
