const LOGICAL_LOCATIONS = [
  "private-file-quarantine",
  "private-files",
  "project-attachments",
  "document-templates",
];

export const OBJECT_STORAGE_QUARANTINE_BUCKET = LOGICAL_LOCATIONS[0];
export const OBJECT_STORAGE_PRIVATE_BUCKET = LOGICAL_LOCATIONS[1];
export const OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET = LOGICAL_LOCATIONS[2];
export const OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET = LOGICAL_LOCATIONS[3];

export const AGENCYOS_OBJECT_STORAGE_BUCKETS = Object.freeze([...LOGICAL_LOCATIONS]);

function required(name, environment) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function parseObjectStorageEndpoint(value, label = "OBJECT_STORAGE_ENDPOINT") {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTP or HTTPS URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must use http:// or https://.`);
  }
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
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value) ||
    value.includes("..") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
  ) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return value;
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

function storageLocations(environment, namespace) {
  const bucketName = `${namespace}_BUCKET`;
  const sharedBucket = validateBucket(bucketName, required(bucketName, environment));
  const locations = LOGICAL_LOCATIONS.map((logicalBucket) => ({
    logicalBucket,
    bucket: sharedBucket,
    prefix: logicalBucket,
  }));
  assertNoOverlap(locations);
  return locations;
}

function configurationNamespace(credentialKind) {
  return credentialKind === "recovery" ? "RECOVERY_OBJECT_STORAGE" : "OBJECT_STORAGE";
}

function credentialNames(namespace, credentialKind) {
  if (credentialKind === "backup-source") {
    return {
      accessKey: "OBJECT_STORAGE_BACKUP_ACCESS_KEY_ID",
      secretKey: "OBJECT_STORAGE_BACKUP_SECRET_ACCESS_KEY",
    };
  }
  return {
    accessKey: `${namespace}_ACCESS_KEY_ID`,
    secretKey: `${namespace}_SECRET_ACCESS_KEY`,
  };
}

export function objectStorageConfiguration(environment = process.env, credentialKind = "runtime") {
  const namespace = configurationNamespace(credentialKind);
  const endpointName = `${namespace}_ENDPOINT`;
  const endpoint = parseObjectStorageEndpoint(required(endpointName, environment), endpointName);
  const credentials = credentialNames(namespace, credentialKind);
  const { value: normalizedEndpoint, ...connection } = endpoint;
  return {
    endpoint: normalizedEndpoint,
    ...connection,
    region: required(`${namespace}_REGION`, environment),
    accessKey: credentialKind === "descriptor" ? "" : required(credentials.accessKey, environment),
    secretKey: credentialKind === "descriptor" ? "" : required(credentials.secretKey, environment),
    locations: storageLocations(environment, namespace),
  };
}

export function resolveObjectStorageLocation(configuration, logicalBucket, objectName = "") {
  const location = configuration.locations.find((entry) => entry.logicalBucket === logicalBucket);
  if (!location) throw new Error("object-storage-bucket-not-allowed");
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
    endpoint: configuration.endpoint,
    region: configuration.region,
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
      if (source.endpoint !== target.endpoint || sourceLocation.bucket !== targetLocation.bucket) {
        continue;
      }
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
  const backupEndpoint = parseObjectStorageEndpoint(
    required("B2_ENDPOINT", environment),
    "B2_ENDPOINT",
  );
  if (!backupEndpoint.useSSL) throw new Error("B2_ENDPOINT must use HTTPS.");
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
