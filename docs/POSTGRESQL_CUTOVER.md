# PostgreSQL cutover and provider moves

The cloud Coolify manifest uses a pooled TLS `DATABASE_URL` for app/worker and a direct TLS
`DATABASE_ADMIN_URL` for migrations and dumps. Vaultwarden uses its own hosted database plus a
direct `VAULTWARDEN_DATABASE_ADMIN_URL`. Selecting the cloud manifest does not copy existing data;
perform the cutover below under a write freeze and verify it before moving the domain.

AgencyOS no longer requires Supabase after cutover. The target architecture is:

```text
AgencyOS web + worker
        |
        +-- PostgreSQL (Neon, local/self-hosted, or another compatible provider)
        +-- S3-compatible object storage
        +-- Redis (optional but recommended)
        +-- ClamAV / Resend / AI providers as configured
```

Authentication, sessions, password reset, email verification, and TOTP MFA are AgencyOS-owned PostgreSQL records.

## Important cutover behavior

- Existing user UUIDs are preserved.
- Standard Supabase email/password users keep their existing passwords because migration 60 imports bcrypt hashes from the old `auth.users.encrypted_password` column.
- Non-bcrypt legacy/imported password hashes are intentionally not copied; those rare accounts use AgencyOS password reset.
- Existing hosted-auth sessions are invalidated. Everyone signs in again after cutover.
- Hosted-provider MFA secrets are not copied. Users whose organization requires MFA re-enroll their authenticator after first password sign-in.
- Object storage remains independent; this database move does not move object bytes.

## 1. Overlay and remove legacy source artifacts

After overlaying the no-Supabase source into the existing checkout:

```bash
npm run cutover:remove-legacy-provider
npm ci
npm run verify
```

Do not delete the old hosted database yet. It is the one-time source for user password hashes and current AgencyOS data.

## 2. Prepare the current database for export

Temporarily point both database variables at the current database. `DATABASE_ADMIN_URL` must be the direct/non-pooled PostgreSQL URL.

```env
DATABASE_URL=postgresql://CURRENT_RUNTIME_OR_DIRECT_URL
DATABASE_ADMIN_URL=postgresql://CURRENT_DIRECT_ADMIN_URL
```

Apply all local migrations:

```bash
npm run db:status
npm run db:migrate
npm run db:status
```

The important cutover migrations are:

- `20260819005900_database_provider_portability.sql`
- `20260819006000_first_party_auth.sql`
- `20260819006100_first_party_identity_context.sql`

Migration 59 copies stable identity data and rewires foreign keys away from the old hosted auth table. Migration 60 imports supported bcrypt credentials and creates AgencyOS sessions/tokens/MFA tables. Migration 61 removes the final runtime RLS dependency on the old auth helper.

Do not run `db:doctor` against the old hosted source if it still contains provider-managed `auth`/`storage` schemas. `db:doctor` is a final-target check.

## 3. Create an empty Neon database

Create a new empty Neon database. Keep two connection strings:

- pooled/runtime connection -> future `DATABASE_URL`
- direct/non-pooled connection -> future `DATABASE_ADMIN_URL`

Install PostgreSQL client utilities locally if `pg_dump` and `pg_restore` are not available.

## 4. Copy AgencyOS schemas to Neon

```bash
export SOURCE_DATABASE_ADMIN_URL='postgresql://CURRENT_DIRECT_SOURCE_URL'
export TARGET_DATABASE_ADMIN_URL='postgresql://NEON_DIRECT_TARGET_URL'
export AGENCYOS_DATABASE_COPY_CONFIRM='COPY_TO_EMPTY_TARGET'

npm run db:copy
```

`db:copy` refuses a source that has not completed the first-party identity cutover, refuses a non-empty target, dumps only AgencyOS-owned schemas (`public`, `private`, `agency_migrations`), restores them, removes migration-only compatibility objects, and verifies core row counts.

Before copying, it also verifies that every active, non-disabled AgencyOS user has a real login email address and a local password credential. This prevents phone-only identities, social/OAuth-only accounts, or unsupported legacy password hashes from being stranded at cutover. Assign a real email where required and complete AgencyOS password reset for users without a local credential first. Only when you intentionally accept post-cutover password resets for users who already have valid emails may you override the missing-credential guard with:

```bash
export AGENCYOS_ALLOW_PASSWORD_RESET_USERS=1
```

The target `npm run db:doctor` remains non-green while any active user lacks a local credential, so the exception cannot become an invisible permanent state.

It does not copy the old provider's auth/storage/platform schemas.

## 5. Switch runtime to Neon

Update `.env.local`:

```env
DATABASE_URL='postgresql://NEON_POOLED_RUNTIME_URL'
DATABASE_ADMIN_URL='postgresql://NEON_DIRECT_URL'
AUTH_ENCRYPTION_KEY='BASE64_OR_HEX_32_BYTE_KEY'
```

Generate a stable MFA encryption key once:

```bash
openssl rand -base64 32
```

Then remove all former provider environment variables from local/deployment secret stores.

Run:

```bash
npm run db:status
npm run db:doctor
npm run db:test
npm run verify
npm run worker -- --once
```

Only when these pass, start:

```bash
npm run dev
```

and in another terminal:

```bash
npm run worker
```

## 6. Acceptance test before deleting the old provider

Test at least:

1. existing owner signs in with the same password;
2. privileged user re-enrolls TOTP and reaches AAL2;
3. sign-out revokes both identity and security-session state;
4. password reset sends/accepts a one-time link and revokes active sessions;
5. organization, roles, permissions, dashboard, CRM, Projects, Finance, HR, Reports, Documents, and founder reports load correctly;
6. report delivery, notification worker, project reminder worker, and other scheduled jobs run once without duplicate work;
7. object-storage upload/download/scanner paths work;
8. cross-organization and lower-scope users remain denied;
9. `npm run db:doctor` reports no legacy compatibility objects;
10. backup and restore of the Neon database is tested in isolation.

After this acceptance pass and a retained backup of the former database, the old Supabase project can be deleted. AgencyOS will no longer call it.

## Move Neon to local PostgreSQL later

Create an empty local database, then:

```bash
export SOURCE_DATABASE_ADMIN_URL='postgresql://NEON_DIRECT_URL'
export TARGET_DATABASE_ADMIN_URL='postgresql://postgres:password@127.0.0.1:5432/agencyos'
export AGENCYOS_DATABASE_COPY_CONFIRM='COPY_TO_EMPTY_TARGET'
npm run db:copy
```

Set both local runtime/admin URLs, then run:

```bash
npm run db:status
npm run db:doctor
npm run db:test
npm run verify
```

No authentication migration is needed because identity is already part of AgencyOS data.

## Move to another PostgreSQL provider later

Use the same `db:copy` procedure. Provider migration is now a PostgreSQL source/target operation; no AgencyOS business schema or authentication code changes are required.

## Fresh installation without any former provider

For a brand-new empty PostgreSQL database:

```bash
npm run db:migrate
npm run db:doctor
npm run db:test
```

The migration runner temporarily creates compatibility objects needed to replay historical migration files, then removes them after the current first-party identity migration. They do not remain in the runtime database.
