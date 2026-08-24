import "server-only";

import { randomUUID } from "node:crypto";

import { getDatabaseClient } from "@/integrations/postgres/database";

export async function verifyIdentityPassword(input: {
  email?: string;
  userId?: string;
  password: string;
}): Promise<{
  userId: string;
  email: string;
  emailConfirmedAt: Date | null;
  metadata: Record<string, unknown>;
} | null> {
  if (!input.email && !input.userId) return null;
  const database = getDatabaseClient();
  const [row] = await database<
    {
      user_id: string;
      email: string;
      email_confirmed_at: Date | null;
      raw_user_meta_data: Record<string, unknown> | null;
    }[]
  >`
    select account.id as user_id, account.email, account.email_confirmed_at, account.raw_user_meta_data
    from public.identity_accounts account
    join public.identity_credentials credential on credential.user_id = account.id
    where account.disabled_at is null
      and (${input.userId ?? null}::uuid is null or account.id = ${input.userId ?? null}::uuid)
      and (${input.email?.toLowerCase() ?? null}::text is null or lower(account.email) = ${input.email?.toLowerCase() ?? null})
      and extensions.crypt(${input.password}, credential.password_hash) = credential.password_hash
    limit 1
  `;
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    emailConfirmedAt: row.email_confirmed_at,
    metadata: row.raw_user_meta_data ?? {},
  };
}

export async function createLocalIdentity(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<{ id: string; created: boolean; confirmed: boolean }> {
  const database = getDatabaseClient();
  const existing = await database<{ id: string; email_confirmed_at: Date | null }[]>`
    select id, email_confirmed_at from public.identity_accounts
    where lower(email) = lower(${input.email})
    limit 1
  `;
  if (existing[0]) {
    return {
      id: existing[0].id,
      created: false,
      confirmed: Boolean(existing[0].email_confirmed_at),
    };
  }

  const id = randomUUID();
  await database.begin(async (sql) => {
    await sql`
      insert into public.identity_accounts (
        id, auth_provider, provider_subject, email, raw_user_meta_data, last_seen_at
      ) values (
        ${id}::uuid, 'agencyos', ${id}, lower(${input.email}),
        ${JSON.stringify({ full_name: input.fullName })}::jsonb, now()
      )
    `;
    await sql`
      insert into public.identity_credentials (user_id, password_hash)
      values (${id}::uuid, extensions.crypt(${input.password}, extensions.gen_salt('bf', 12)))
    `;
    await sql`
      insert into public.profiles (id, display_name)
      values (${id}::uuid, ${input.fullName})
      on conflict (id) do nothing
    `;
  });
  return { id, created: true, confirmed: false };
}

export async function setIdentityPassword(userId: string, password: string): Promise<void> {
  const database = getDatabaseClient();
  await database`
    insert into public.identity_credentials (user_id, password_hash, password_changed_at)
    values (${userId}::uuid, extensions.crypt(${password}, extensions.gen_salt('bf', 12)), now())
    on conflict (user_id) do update
    set password_hash = excluded.password_hash, password_changed_at = now()
  `;
}
