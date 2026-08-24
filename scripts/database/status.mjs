import {
  createAdminClient,
  getAdminDatabaseUrl,
  readAppliedMigrations,
  readMigrationFiles,
  redactDatabaseUrl,
} from "./portable-database.mjs";

const databaseUrl = getAdminDatabaseUrl();
const sql = createAdminClient(databaseUrl);

try {
  const migrations = await readMigrationFiles();
  const history = await sql`
    select to_regclass('agency_migrations.schema_migrations') is not null as exists
  `;
  const applied = history[0]?.exists ? await readAppliedMigrations(sql) : new Map();
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  const drifted = migrations.filter((migration) => {
    const row = applied.get(migration.version);
    return row?.checksum && row.checksum !== migration.checksum;
  });

  console.log(`Target: ${redactDatabaseUrl(databaseUrl)}`);
  console.log(`Applied: ${applied.size}`);
  console.log(`Local migrations: ${migrations.length}`);
  console.log(`Pending: ${pending.length}`);
  console.log(`Checksum drift: ${drifted.length}`);

  for (const migration of pending) console.log(`  pending ${migration.fileName}`);
  for (const migration of drifted) console.log(`  DRIFT   ${migration.fileName}`);

  if (drifted.length > 0) process.exitCode = 2;
} finally {
  await sql.end({ timeout: 5 });
}
