import {
  inspectLegacySelfManagedMigration,
  legacySelfManagedMigrationVersions,
} from "./legacy-migration-recovery.mjs";
import {
  bootstrapPortableCompatibility,
  cleanupPortableCompatibility,
  createAdminClient,
  ensureAgencyMigrationHistory,
  getAdminDatabaseUrl,
  readAppliedMigrations,
  readMigrationFiles,
  redactDatabaseUrl,
} from "./portable-database.mjs";

const databaseUrl = getAdminDatabaseUrl();
const sql = createAdminClient(databaseUrl);
let locked = false;

try {
  console.log(`AgencyOS database migration target: ${redactDatabaseUrl(databaseUrl)}`);
  await bootstrapPortableCompatibility(sql);
  await ensureAgencyMigrationHistory(sql);

  await sql`select pg_advisory_lock(hashtextextended('agencyos:migrations', 0))`;
  locked = true;

  const migrations = await readMigrationFiles();
  const applied = await readAppliedMigrations(sql);
  let appliedCount = 0;

  for (const migration of migrations) {
    const existing = applied.get(migration.version);
    if (existing) {
      if (existing.checksum && existing.checksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.fileName} changed after it was applied. Forward-only migration history cannot be rewritten.`,
        );
      }
      if (!existing.checksum) {
        await sql`
          update agency_migrations.schema_migrations
          set checksum = ${migration.checksum}, name = ${migration.name}
          where version = ${migration.version}
        `;
      }
      continue;
    }

    console.log(`Applying ${migration.fileName} ...`);
    const managesOwnTransaction =
      /^\s*begin\s*;/im.test(migration.sql) && /^\s*commit\s*;/im.test(migration.sql);

    if (managesOwnTransaction) {
      if (!legacySelfManagedMigrationVersions.has(migration.version)) {
        throw new Error(
          `Migration ${migration.fileName} manages its own transaction. New migrations must let the AgencyOS runner own the transaction so schema changes and migration history commit atomically.`,
        );
      }

      // Two immutable historical migrations contain BEGIN/COMMIT. If a previous
      // runner crashed after their COMMIT but before the history insert, detect
      // the fully-applied schema and repair only the ledger instead of replaying DDL.
      const recovery = await inspectLegacySelfManagedMigration(sql, migration.version);
      if (recovery.state === "partial") {
        throw new Error(
          `Historical migration ${migration.fileName} appears partially applied. Refusing automatic replay; restore/repair the schema, then rerun migrations.`,
        );
      }
      if (recovery.state === "not_applied") {
        await sql.unsafe(migration.sql);
      } else {
        console.warn(
          `Recovered committed migration history for ${migration.fileName}; schema objects were already present.`,
        );
      }
      await sql`
        insert into agency_migrations.schema_migrations (version, name, checksum)
        values (${migration.version}, ${migration.name}, ${migration.checksum})
        on conflict (version) do update
        set name = excluded.name, checksum = excluded.checksum
      `;
    } else {
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration.sql);
        await transaction`
          insert into agency_migrations.schema_migrations (version, name, checksum)
          values (${migration.version}, ${migration.name}, ${migration.checksum})
          on conflict (version) do update
          set name = excluded.name, checksum = excluded.checksum
        `;
      });
    }
    appliedCount += 1;
  }

  console.log(
    appliedCount === 0
      ? `Database is current (${migrations.length} migrations).`
      : `Applied ${appliedCount} migration${appliedCount === 1 ? "" : "s"}; database is current (${migrations.length} total).`,
  );

  if (
    applied.has("20260819006100") ||
    migrations.some((migration) => migration.version === "20260819006100")
  ) {
    await cleanupPortableCompatibility(sql);
  }
} finally {
  if (locked) {
    await sql`select pg_advisory_unlock(hashtextextended('agencyos:migrations', 0))`.catch(
      () => undefined,
    );
  }
  await sql.end({ timeout: 5 });
}
