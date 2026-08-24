import * as Minio from "minio";

const buckets = [
  "private-file-quarantine",
  "private-files",
  "project-attachments",
  "document-templates",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseEndpoint(value) {
  const endpoint = new URL(value);
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("MINIO_ENDPOINT must use http:// or https://.");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("MINIO_ENDPOINT must not include credentials, a query, or a fragment.");
  }
  if (endpoint.pathname && endpoint.pathname !== "/") {
    throw new Error("MINIO_ENDPOINT must not include a path.");
  }
  return {
    endPoint: endpoint.hostname.replace(/^\[|\]$/g, ""),
    port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === "https:" ? 443 : 80,
    useSSL: endpoint.protocol === "https:",
  };
}

const client = new Minio.Client({
  ...parseEndpoint(required("MINIO_ENDPOINT")),
  accessKey: required("MINIO_ACCESS_KEY"),
  secretKey: required("MINIO_SECRET_KEY"),
  region: process.env.MINIO_REGION?.trim() || "us-east-1",
});

for (const bucket of buckets) {
  if (!(await client.bucketExists(bucket))) {
    await client.makeBucket(bucket, process.env.MINIO_REGION?.trim() || "us-east-1");
    console.log(`Created private MinIO bucket: ${bucket}`);
  } else {
    console.log(`MinIO bucket exists: ${bucket}`);
  }

  try {
    const policy = await client.getBucketPolicy(bucket);
    if (policy) {
      throw new Error(
        `Bucket ${bucket} has a bucket policy. Remove all anonymous/public grants before using AgencyOS.`,
      );
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (!["NoSuchBucketPolicy", "NoSuchPolicy"].includes(code)) throw error;
  }
}

console.log("MinIO storage is ready. All AgencyOS buckets have no public bucket policy.");
