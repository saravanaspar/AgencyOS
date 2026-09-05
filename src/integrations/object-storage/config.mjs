const LOGICAL_LOCATIONS = [
  ["private-file-quarantine", "QUARANTINE"],
  ["private-files", "PRIVATE_FILES"],
  ["project-attachments", "PROJECT_ATTACHMENTS"],
  ["document-templates", "DOCUMENT_TEMPLATES"],
];

export const AGENCYOS_OBJECT_STORAGE_BUCKETS = Object.freeze(
  LOGICAL_LOCATIONS.map(([logicalBucket]) => logicalBucket),
);

function required(name, environment) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseEndpoint(value, { cloud, label }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTP or HTTPS URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must use http:// or https://.`);
  }
  if (cloud && url.protocol !== "https:") throw new Error(`${label} must use HTTPS in cloud mode.`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error(`${label} must not contain a path, query, or fragment.`);
  }
  if (!url.hostname) throw new Error(`${label} must include a hostname.`);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return {
    value: `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}`,
    hostname: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(port),
    useSSL: url.protocol === "https:",
  };
}

function validateBucket(label, value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,62}$/.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return value;
}

function validatePrefix(label, value) {
  const prefix = value.trim();
  if (!prefix) return "";
  if (
    prefix.startsWith("/") ||
    prefix.endsWith("/") ||
    prefix.includes("\\") ||
    prefix.includes("//") ||
    /[\x00-\x1f\x7f]/.test(prefix) ||
    prefix.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} contains an unsafe or ambiguous prefix.`);
  }
  return prefix;
}

export function infrastructureMode(environment = process.env) {
  const raw = environment.AGENCYOS_INFRA_MODE?.trim();
  if (!raw) {
    if (environment.NODE_ENV === "production") {
      throw new Error("AGENCYOS_INFRA_MODE is required in production.");
    }
    return "local";
  }
  if (!["local", "cloud"].includes(raw)) {
    throw new Error("AGENCYOS_INFRA_MODE must be local or cloud.");
  }
  return raw;
}

function assertNoOverlap(locations, label = "Object-storage") {
  for (let index = 0; index < locations.length; index += 1) {
    for (let other = index + 1; other < locations.length; other += 1) {
      const left = locations[index];
      const right = locations[other];
      if (left.bucket !== right.bucket) continue;
      const overlap =
        left.prefix === right.prefix ||
        !left.prefix ||
        !right.prefix ||
        left.prefix.startsWith(`${right.prefix}/`) ||
        right.prefix.startsWith(`${left.prefix}/`);
      if (overlap) {
        throw new Error(`${label} logical locations must not overlap in bucket ${left.bucket}.`);
      }
    }
  }
}

function genericLocations(environment, prefix = "OBJECT_STORAGE") {
  const locations = LOGICAL_LOCATIONS.map(([logicalBucket, suffix]) => ({
    logicalBucket,
    bucket: validateBucket(
      `${prefix}_${suffix}_BUCKET`,
      required(`${prefix}_${suffix}_BUCKET`, environment),
    ),
    prefix: validatePrefix(
      `${prefix}_${suffix}_PREFIX`,
      environment[`${prefix}_${suffix}_PREFIX`]?.trim() || "",
    ),
  }));
  assertNoOverlap(locations);
  return locations;
}

export function objectStorageConfiguration(environment = process.env, credentialKind = "runtime") {
  const recovery = credentialKind === "recovery";
  const mode = recovery
    ? environment.RECOVERY_OBJECT_STORAGE_PROVIDER?.trim() === "b2"
      ? "cloud"
      : "local"
    : infrastructureMode(environment);
  const provider = recovery
    ? environment.RECOVERY_OBJECT_STORAGE_PROVIDER?.trim() || "minio"
    : environment.OBJECT_STORAGE_PROVIDER?.trim() || (mode === "local" ? "minio" : "");
  if (!["minio", "b2"].includes(provider))
    throw new Error("OBJECT_STORAGE_PROVIDER must be minio or b2.");
  if (
    !recovery &&
    ((mode === "local" && provider !== "minio") || (mode === "cloud" && provider !== "b2"))
  ) {
    throw new Error("OBJECT_STORAGE_PROVIDER must agree with AGENCYOS_INFRA_MODE.");
  }

  if (recovery && environment.RECOVERY_OBJECT_STORAGE_ENDPOINT?.trim()) {
    const endpoint = parseEndpoint(required("RECOVERY_OBJECT_STORAGE_ENDPOINT", environment), {
      cloud: provider === "b2",
      label: "RECOVERY_OBJECT_STORAGE_ENDPOINT",
    });
    return {
      mode,
      provider,
      endpoint: endpoint.value,
      ...endpoint,
      region: environment.RECOVERY_OBJECT_STORAGE_REGION?.trim() || "us-east-1",
      accessKey: required("RECOVERY_OBJECT_STORAGE_ACCESS_KEY_ID", environment),
      secretKey: required("RECOVERY_OBJECT_STORAGE_SECRET_ACCESS_KEY", environment),
      locations: genericLocations(environment, "RECOVERY_OBJECT_STORAGE"),
    };
  }

  if (mode === "local") {
    if (
      !recovery &&
      Object.keys(environment).some(
        (name) =>
          name !== "OBJECT_STORAGE_PROVIDER" &&
          name.startsWith("OBJECT_STORAGE_") &&
          environment[name]?.trim(),
      )
    ) {
      throw new Error("Cloud OBJECT_STORAGE_* variables are not allowed in local production mode.");
    }
    const endpointName = recovery ? "RECOVERY_MINIO_ENDPOINT" : "MINIO_ENDPOINT";
    const accessName = recovery ? "RECOVERY_MINIO_ACCESS_KEY" : "MINIO_ACCESS_KEY";
    const secretName = recovery ? "RECOVERY_MINIO_SECRET_KEY" : "MINIO_SECRET_KEY";
    const endpoint = parseEndpoint(required(endpointName, environment), {
      cloud: false,
      label: endpointName,
    });
    return {
      mode,
      provider: "minio",
      endpoint: endpoint.value,
      ...endpoint,
      region: environment.MINIO_REGION?.trim() || "us-east-1",
      accessKey: credentialKind === "descriptor" ? "" : required(accessName, environment),
      secretKey: credentialKind === "descriptor" ? "" : required(secretName, environment),
      locations: AGENCYOS_OBJECT_STORAGE_BUCKETS.map((logicalBucket) => ({
        logicalBucket,
        bucket: logicalBucket,
        prefix: "",
      })),
    };
  }

  if (
    [
      "MINIO_ENDPOINT",
      "MINIO_ACCESS_KEY",
      "MINIO_SECRET_KEY",
      "MINIO_ROOT_USER",
      "MINIO_ROOT_PASSWORD",
    ].some((name) => environment[name]?.trim())
  ) {
    throw new Error("MinIO endpoint and credentials are not allowed in cloud mode.");
  }
  const endpoint = parseEndpoint(required("OBJECT_STORAGE_ENDPOINT", environment), {
    cloud: true,
    label: "OBJECT_STORAGE_ENDPOINT",
  });
  const accessKeyName =
    credentialKind === "backup-source"
      ? "OBJECT_STORAGE_BACKUP_ACCESS_KEY_ID"
      : "OBJECT_STORAGE_ACCESS_KEY_ID";
  const secretKeyName =
    credentialKind === "backup-source"
      ? "OBJECT_STORAGE_BACKUP_SECRET_ACCESS_KEY"
      : "OBJECT_STORAGE_SECRET_ACCESS_KEY";
  return {
    mode,
    provider,
    endpoint: endpoint.value,
    ...endpoint,
    region: required("OBJECT_STORAGE_REGION", environment),
    accessKey: credentialKind === "descriptor" ? "" : required(accessKeyName, environment),
    secretKey: credentialKind === "descriptor" ? "" : required(secretKeyName, environment),
    locations: genericLocations(environment),
  };
}

export function resolveObjectStorageLocation(configuration, logicalBucket, objectName = "") {
  const location = configuration.locations.find((entry) => entry.logicalBucket === logicalBucket);
  if (!location) throw new Error("minio-bucket-not-allowed");
  return {
    logicalBucket,
    physicalBucket: location.bucket,
    physicalKey: location.prefix
      ? objectName
        ? `${location.prefix}/${objectName}`
        : location.prefix
      : objectName,
    prefix: location.prefix,
  };
}

export function redactedObjectStorageDescriptor(configuration) {
  return {
    provider: configuration.provider,
    locations: configuration.locations.map(({ logicalBucket, bucket, prefix }) => ({
      logicalBucket,
      bucket,
      prefix,
    })),
  };
}

export function normalizedObjectStorageDestination(configuration, location) {
  return `${configuration.endpoint}/${location.bucket}/${location.prefix}`.replace(/\/$/, "");
}

export function assertObjectStorageIsolation(source, target, label = "Recovery object storage") {
  for (const sourceLocation of source.locations) {
    for (const targetLocation of target.locations) {
      if (source.endpoint !== target.endpoint || sourceLocation.bucket !== targetLocation.bucket)
        continue;
      const left = sourceLocation.prefix;
      const right = targetLocation.prefix;
      if (
        !left ||
        !right ||
        left === right ||
        left.startsWith(`${right}/`) ||
        right.startsWith(`${left}/`)
      ) {
        throw new Error(`${label} must not overlap a production object-storage location.`);
      }
    }
  }
}

export function assertRuntimeBackupIsolation(configuration, environment = process.env) {
  const backupEndpoint = parseEndpoint(required("B2_ENDPOINT", environment), {
    cloud: true,
    label: "B2_ENDPOINT",
  });
  const backupBucket = validateBucket("B2_BUCKET", required("B2_BUCKET", environment));
  if (
    configuration.endpoint === backupEndpoint.value &&
    configuration.locations.some((entry) => entry.bucket === backupBucket)
  ) {
    throw new Error(
      "Runtime object storage and immutable backup storage must use different buckets.",
    );
  }
  const ids = [
    environment.OBJECT_STORAGE_ACCESS_KEY_ID,
    environment.OBJECT_STORAGE_BACKUP_ACCESS_KEY_ID,
    environment.B2_WRITER_KEY_ID,
  ]
    .map((value) => value?.trim())
    .filter(Boolean);
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      "Runtime, backup-source, and immutable backup credentials must use different key IDs.",
    );
  }
}
