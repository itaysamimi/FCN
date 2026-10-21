import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

let client: S3Client | undefined;

// S3-compatible client for Cloudflare R2. Server only: holds the R2 secret.
export function getR2Client() {
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

export function getBucket() {
  return process.env.R2_BUCKET_NAME!;
}
