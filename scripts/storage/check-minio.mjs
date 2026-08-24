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

const endpoint = new URL(required("MINIO_ENDPOINT"));
const client = new Minio.Client({
  endPoint: endpoint.hostname.replace(/^\[|\]$/g, ""),
  port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === "https:" ? 443 : 80,
  useSSL: endpoint.protocol === "https:",
  accessKey: required("MINIO_ACCESS_KEY"),
  secretKey: required("MINIO_SECRET_KEY"),
  region: process.env.MINIO_REGION?.trim() || "us-east-1",
});

for (const bucket of buckets) {
  if (!(await client.bucketExists(bucket))) throw new Error(`Missing MinIO bucket: ${bucket}`);
}

console.log(
  `MinIO is reachable at ${endpoint.origin}; ${buckets.length} AgencyOS buckets are ready.`,
);
