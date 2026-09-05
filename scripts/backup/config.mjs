import { isAbsolute, relative, resolve } from "node:path";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const RECOVERY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export function requiredEnvironment(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function boundedInteger(name, fallback, minimum, maximum, environment = process.env) {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function safeName(name, value) {
  if (!NAME_PATTERN.test(value)) throw new Error(`${name} contains unsupported characters.`);
  return value;
}

export function safeRecoveryId(value) {
  if (!RECOVERY_ID_PATTERN.test(value)) {
    throw new Error("AGENCYOS_RECOVERY_ID must be a lowercase, hyphenated identifier.");
  }
  return value;
}

export function resolveWithin(root, candidate) {
  const rootPath = resolve(root);
  const path = resolve(candidate);
  const fromRoot = relative(rootPath, path);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Path must remain inside ${rootPath}.`);
  }
  return path;
}

export function parsePostgresConnection(value, label) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${label} must use postgres:// or postgresql://.`);
  }
  if (!url.hostname || !url.username || !url.pathname.slice(1)) {
    throw new Error(`${label} must include host, user, and database.`);
  }
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    sslmode: url.searchParams.get("sslmode") || undefined,
  };
}

export function postgresEnvironment(value, label) {
  const parsed = parsePostgresConnection(value, label);
  return {
    PGHOST: parsed.host,
    PGPORT: parsed.port,
    PGUSER: parsed.user,
    PGPASSWORD: parsed.password,
    PGDATABASE: parsed.database,
    ...(parsed.sslmode ? { PGSSLMODE: parsed.sslmode } : {}),
  };
}

export function resticEnvironment(environment = process.env, credentialKind = "writer") {
  const endpoint = requiredEnvironment("B2_ENDPOINT", environment).replace(/\/$/, "");
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== "https:" || endpointUrl.username || endpointUrl.password) {
    throw new Error("B2_ENDPOINT must be an HTTPS URL without credentials.");
  }
  const bucket = safeName("B2_BUCKET", requiredEnvironment("B2_BUCKET", environment));
  const prefix = requiredEnvironment("B2_PREFIX", environment).replace(/^\/+|\/+$/g, "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,255}$/.test(prefix) || prefix.includes("..")) {
    throw new Error("B2_PREFIX contains unsupported characters.");
  }
  const keySuffix =
    credentialKind === "maintenance"
      ? "MAINTENANCE"
      : credentialKind === "restore"
        ? "RESTORE"
        : "WRITER";
  return {
    RESTIC_REPOSITORY: `s3:${endpointUrl.href.replace(/\/$/, "")}/${bucket}/${prefix}`,
    RESTIC_PASSWORD: requiredEnvironment("RESTIC_PASSWORD", environment),
    AWS_ACCESS_KEY_ID: requiredEnvironment(`B2_${keySuffix}_KEY_ID`, environment),
    AWS_SECRET_ACCESS_KEY: requiredEnvironment(`B2_${keySuffix}_APPLICATION_KEY`, environment),
    AWS_DEFAULT_REGION: environment.B2_REGION?.trim() || "us-west-004",
    RESTIC_CACHE_DIR: environment.RESTIC_CACHE_DIR?.trim() || "/cache",
  };
}

export function backupConfiguration(environment = process.env) {
  const stateDirectory = resolve(environment.AGENCYOS_BACKUP_STATE_DIR?.trim() || "/state");
  const stageRoot = resolve(environment.AGENCYOS_BACKUP_STAGE_DIR?.trim() || "/stage");
  const vaultwardenData = resolve(
    environment.AGENCYOS_VAULTWARDEN_DATA_DIR?.trim() || "/vaultwarden-data",
  );
  return {
    stateDirectory,
    stageRoot,
    vaultwardenData,
    agencyDatabaseUrl: requiredEnvironment("DATABASE_ADMIN_URL", environment),
    vaultwardenDatabaseUrl: requiredEnvironment("VAULTWARDEN_DATABASE_URL", environment),
    minioEndpoint: requiredEnvironment("MINIO_ENDPOINT", environment),
    minioRootUser: requiredEnvironment("MINIO_ROOT_USER", environment),
    minioRootPassword: requiredEnvironment("MINIO_ROOT_PASSWORD", environment),
    restic: resticEnvironment(environment, "writer"),
    host: safeName("BACKUP_HOST", environment.BACKUP_HOST?.trim() || "agencyos-production"),
    releaseId: environment.AGENCYOS_RELEASE_ID?.trim() || "unknown",
    maxAgeHours: boundedInteger("BACKUP_MAX_AGE_HOURS", 30, 1, 168, environment),
    commandTimeoutMs: boundedInteger(
      "BACKUP_COMMAND_TIMEOUT_MS",
      3_600_000,
      10_000,
      7_200_000,
      environment,
    ),
  };
}

export function scheduleConfiguration(environment = process.env, mode = "backup") {
  return {
    hourUtc: boundedInteger(
      mode === "maintenance" ? "BACKUP_MAINTENANCE_HOUR_UTC" : "BACKUP_HOUR_UTC",
      mode === "maintenance" ? 5 : 2,
      0,
      23,
      environment,
    ),
    jitterMinutes: boundedInteger("BACKUP_JITTER_MINUTES", 20, 0, 120, environment),
    maxAgeHours: boundedInteger("BACKUP_MAX_AGE_HOURS", 30, 1, 168, environment),
  };
}

export function assertRestoreEnvironment(environment = process.env) {
  if (environment.AGENCYOS_RESTORE_DRILL !== "1" || environment.NODE_ENV === "production") {
    throw new Error(
      "Restore commands require AGENCYOS_RESTORE_DRILL=1 and NODE_ENV must not be production.",
    );
  }
  return {
    snapshot: safeName(
      "AGENCYOS_RESTORE_SNAPSHOT",
      requiredEnvironment("AGENCYOS_RESTORE_SNAPSHOT", environment),
    ),
    recoveryId: safeRecoveryId(requiredEnvironment("AGENCYOS_RECOVERY_ID", environment)),
    recoveryRoot: resolve(environment.AGENCYOS_RECOVERY_ROOT?.trim() || "/recovery"),
  };
}
