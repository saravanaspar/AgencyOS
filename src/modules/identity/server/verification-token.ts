import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { getDatabaseClient } from "@/integrations/postgres/database";

export type IdentityVerificationPurpose = "email_verification" | "password_reset";

function hashToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export async function issueIdentityVerificationToken(input: {
  userId: string;
  purpose: IdentityVerificationPurpose;
  lifetimeMinutes: number;
}): Promise<string> {
  const database = getDatabaseClient();
  const token = randomBytes(32).toString("base64url");
  const hash = hashToken(token);
  await database.begin(async (sql) => {
    await sql`
      update public.identity_verification_tokens
      set consumed_at = coalesce(consumed_at, now())
      where user_id = ${input.userId}::uuid and purpose = ${input.purpose} and consumed_at is null
    `;
    await sql`
      insert into public.identity_verification_tokens (
        id, user_id, purpose, token_hash, expires_at
      ) values (
        ${randomUUID()}::uuid, ${input.userId}::uuid, ${input.purpose}, ${hash},
        now() + make_interval(mins => ${input.lifetimeMinutes})
      )
    `;
  });
  return token;
}

export async function validateIdentityVerificationToken(
  token: string,
  purpose: IdentityVerificationPurpose,
): Promise<{ userId: string; email: string } | null> {
  if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) return null;
  const database = getDatabaseClient();
  const [row] = await database<{ user_id: string; email: string }[]>`
    select verification.user_id, account.email
    from public.identity_verification_tokens verification
    join public.identity_accounts account on account.id = verification.user_id
    where verification.purpose = ${purpose}
      and verification.token_hash = ${hashToken(token)}
      and verification.consumed_at is null
      and verification.expires_at > now()
      and account.disabled_at is null
    limit 1
  `;
  return row ? { userId: row.user_id, email: row.email } : null;
}

export async function consumeIdentityVerificationToken(
  token: string,
  purpose: IdentityVerificationPurpose,
): Promise<{ userId: string; email: string } | null> {
  if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) return null;
  const database = getDatabaseClient();
  const rows = await database<{ user_id: string; email: string }[]>`
    with consumed as (
      update public.identity_verification_tokens
      set consumed_at = now()
      where purpose = ${purpose}
        and token_hash = ${hashToken(token)}
        and consumed_at is null
        and expires_at > now()
      returning user_id
    )
    select consumed.user_id, account.email
    from consumed
    join public.identity_accounts account on account.id = consumed.user_id
    where account.disabled_at is null
  `;
  const row = rows[0];
  return row ? { userId: row.user_id, email: row.email } : null;
}
