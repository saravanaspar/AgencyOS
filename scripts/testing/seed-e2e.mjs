#!/usr/bin/env node
import process from "node:process";

import {
  createAdminClient,
  getAdminDatabaseUrl,
  redactDatabaseUrl,
} from "../database/portable-database.mjs";

if (process.env.AGENCYOS_E2E_CONFIRM_ISOLATED !== "1") {
  throw new Error("Refusing to seed E2E data without AGENCYOS_E2E_CONFIRM_ISOLATED=1.");
}

const email = (process.env.AGENCYOS_E2E_OWNER_EMAIL ?? "owner@e2e.agencyos.test")
  .trim()
  .toLowerCase();
const password = process.env.AGENCYOS_E2E_OWNER_PASSWORD?.trim();
const userId = process.env.AGENCYOS_E2E_OWNER_ID ?? "eee00000-0000-4000-8000-000000000001";
const organizationSlug = (process.env.AGENCYOS_E2E_ORGANIZATION_SLUG ?? "agencyos-e2e")
  .trim()
  .toLowerCase();

if (!password || password.length < 16) {
  throw new Error(
    "AGENCYOS_E2E_OWNER_PASSWORD must be at least 16 characters for the disposable E2E account.",
  );
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  throw new Error("AGENCYOS_E2E_OWNER_ID must be a valid UUID.");
}
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(organizationSlug))
  throw new Error("Invalid E2E organization slug.");

const databaseUrl = getAdminDatabaseUrl();
const sql = createAdminClient(databaseUrl);
try {
  await sql.begin(async (transaction) => {
    await transaction`
      insert into public.identity_accounts (
        id, auth_provider, provider_subject, email, email_confirmed_at,
        raw_user_meta_data, disabled_at, last_seen_at
      ) values (
        ${userId}::uuid, 'agencyos', ${userId}, ${email}, now(),
        ${JSON.stringify({ full_name: "AgencyOS E2E Owner", e2e: true })}::jsonb,
        null, now()
      )
      on conflict (id) do update
      set email = excluded.email,
          email_confirmed_at = coalesce(public.identity_accounts.email_confirmed_at, now()),
          disabled_at = null,
          last_seen_at = now(),
          updated_at = now()
    `;
    await transaction`
      insert into public.identity_credentials (user_id, password_hash, password_changed_at)
      values (${userId}::uuid, extensions.crypt(${password}, extensions.gen_salt('bf', 12)), now())
      on conflict (user_id) do update
      set password_hash = excluded.password_hash, password_changed_at = now()
    `;
    await transaction`
      insert into public.profiles (id, display_name)
      values (${userId}::uuid, 'AgencyOS E2E Owner')
      on conflict (id) do update set display_name = excluded.display_name
    `;
  });

  let [organization] = await sql`
    select organization.id
    from public.organizations organization
    join public.memberships membership
      on membership.organization_id = organization.id
     and membership.user_id = ${userId}::uuid
     and membership.status = 'active'
    where organization.slug = ${organizationSlug}
    limit 1
  `;

  if (!organization) {
    [organization] = await sql`
      select private.bootstrap_organization(
        ${userId}::uuid,
        'AgencyOS E2E',
        ${organizationSlug},
        'US',
        'UTC',
        'USD'
      ) as id
    `;
  }

  await sql`
    update public.organization_security_policies
    set require_privileged_mfa = false,
        recommend_mfa = false,
        updated_at = now()
    where organization_id = ${organization.id}::uuid
  `;
  await sql`
    update public.identity_sessions
    set status = 'revoked', revoked_at = now(), revocation_reason = 'e2e_reseed'
    where user_id = ${userId}::uuid and status in ('pending_mfa', 'active')
  `;

  console.log(
    `Seeded disposable E2E owner ${email} in ${organizationSlug} on ${redactDatabaseUrl(databaseUrl)}.`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
