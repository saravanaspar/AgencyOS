-- Replace the former hosted authentication provider with AgencyOS-owned PostgreSQL authentication.
-- Existing standard bcrypt password hashes are imported when the old auth.users table is available
-- during the one-time cutover. All new authentication state lives in AgencyOS-owned tables.

set lock_timeout = '10s';
set statement_timeout = '120s';

create unique index if not exists identity_accounts_active_email_unique
  on public.identity_accounts (lower(email))
  where disabled_at is null;

create table public.identity_credentials (
  user_id uuid primary key references public.identity_accounts(id) on delete cascade,
  password_hash text not null,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint identity_credentials_password_hash_not_blank check (btrim(password_hash) <> '')
);

create table public.identity_sessions (
  id uuid primary key,
  user_id uuid not null references public.identity_accounts(id) on delete cascade,
  token_hash bytea not null unique,
  status text not null default 'active',
  assurance_level text not null default 'aal1',
  ip_address inet,
  user_agent text,
  issued_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  mfa_verified_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  constraint identity_sessions_status_valid check (status in ('pending_mfa', 'active', 'revoked', 'expired')),
  constraint identity_sessions_assurance_valid check (assurance_level in ('aal1', 'aal2')),
  constraint identity_sessions_token_hash_length check (octet_length(token_hash) = 32),
  constraint identity_sessions_user_agent_bounded check (user_agent is null or char_length(user_agent) <= 500),
  constraint identity_sessions_expiry_valid check (expires_at > issued_at),
  constraint identity_sessions_revocation_consistent check (
    (status in ('pending_mfa', 'active') and revoked_at is null and revocation_reason is null)
    or (status in ('revoked', 'expired') and revoked_at is not null and revocation_reason is not null)
  )
);

create index identity_sessions_user_active_idx
  on public.identity_sessions (user_id, last_seen_at desc)
  where status in ('pending_mfa', 'active');
create index identity_sessions_expiry_idx
  on public.identity_sessions (expires_at)
  where status in ('pending_mfa', 'active');

create table public.identity_verification_tokens (
  id uuid primary key,
  user_id uuid not null references public.identity_accounts(id) on delete cascade,
  purpose text not null,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint identity_verification_tokens_purpose_valid check (purpose in ('email_verification', 'password_reset')),
  constraint identity_verification_tokens_hash_length check (octet_length(token_hash) = 32),
  constraint identity_verification_tokens_expiry_valid check (expires_at > created_at)
);

create index identity_verification_tokens_user_idx
  on public.identity_verification_tokens (user_id, purpose, created_at desc);
create index identity_verification_tokens_active_idx
  on public.identity_verification_tokens (expires_at)
  where consumed_at is null;

create table public.identity_mfa_factors (
  id uuid primary key,
  user_id uuid not null references public.identity_accounts(id) on delete cascade,
  factor_type text not null default 'totp',
  status text not null default 'unverified',
  friendly_name text not null default 'AgencyOS authenticator',
  secret_envelope text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_mfa_factor_type_valid check (factor_type = 'totp'),
  constraint identity_mfa_factor_status_valid check (status in ('unverified', 'verified')),
  constraint identity_mfa_factor_secret_not_blank check (btrim(secret_envelope) <> ''),
  constraint identity_mfa_factor_verified_consistent check (
    (status = 'verified' and verified_at is not null)
    or (status = 'unverified' and verified_at is null)
  )
);

create unique index identity_mfa_verified_user_idx
  on public.identity_mfa_factors (user_id)
  where status = 'verified';
create index identity_mfa_user_status_idx
  on public.identity_mfa_factors (user_id, status, created_at desc);

-- Preserve existing email/password credentials during the one-time cutover.
-- The former provider's standard password accounts use bcrypt hashes in encrypted_password;
-- PostgreSQL pgcrypto crypt() can verify those hashes. Non-bcrypt legacy/imported hashes are
-- intentionally skipped and must use AgencyOS password reset after cutover.
do $credential_backfill$
begin
  if to_regclass('auth.users') is not null then
    execute $copy$
      insert into public.identity_credentials (user_id, password_hash, password_changed_at, created_at)
      select identity.id, source.encrypted_password, coalesce(source.updated_at, now()), coalesce(source.created_at, now())
      from auth.users source
      join public.identity_accounts identity on identity.id = source.id
      where nullif(btrim(source.encrypted_password), '') is not null
        and source.encrypted_password ~ '^\$2[aby]\$'
      on conflict (user_id) do nothing
    $copy$;
  end if;
end
$credential_backfill$;

update public.identity_accounts
set auth_provider = 'agencyos',
    provider_subject = id::text,
    updated_at = now();

-- Hosted sessions and MFA factors are deliberately not migrated. Provider session tokens are not
-- portable, and MFA secrets should not be copied from provider internals. Passwords and UUIDs are
-- preserved; users reauthenticate and re-enroll TOTP when their organization requires it.
update public.security_sessions
set status = 'revoked',
    revoked_at = coalesce(revoked_at, now()),
    revocation_reason = coalesce(revocation_reason, 'auth_provider_cutover')
where status = 'active';

-- Remove the transitional provider synchronization hook introduced by migration 59.
do $remove_provider_hook$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists agencyos_auth_user_sync on auth.users';
  end if;
end
$remove_provider_hook$;

drop function if exists private.sync_identity_account_from_auth_user();

alter table public.identity_credentials enable row level security;
alter table public.identity_sessions enable row level security;
alter table public.identity_verification_tokens enable row level security;
alter table public.identity_mfa_factors enable row level security;

revoke all on public.identity_credentials from public, anon, authenticated;
revoke all on public.identity_sessions from public, anon, authenticated;
revoke all on public.identity_verification_tokens from public, anon, authenticated;
revoke all on public.identity_mfa_factors from public, anon, authenticated;

grant all on public.identity_credentials to service_role;
grant all on public.identity_sessions to service_role;
grant all on public.identity_verification_tokens to service_role;
grant all on public.identity_mfa_factors to service_role;

comment on table public.identity_accounts is
  'AgencyOS-owned identity directory. Authentication no longer depends on an external auth provider.';
comment on table public.identity_credentials is
  'Server-only password credentials. Existing bcrypt hashes are imported at provider cutover; unsupported legacy hash formats require password reset.';
comment on table public.identity_sessions is
  'Server-owned opaque-cookie sessions for AgencyOS authentication.';
comment on table public.identity_verification_tokens is
  'Single-use hashed email-verification and password-reset tokens.';
comment on table public.identity_mfa_factors is
  'Encrypted AgencyOS-owned TOTP factors. Secrets require AUTH_ENCRYPTION_KEY.';
