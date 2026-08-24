import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import {
  legalAccessReviewDueAt,
  legalAccessReviewNextScheduledFor,
  legalAccessReviewNotificationRecipientLimit,
  legalAccessReviewPermissionKeys,
  legalAccessReviewWorkerCampaignLimit,
  type LegalAccessReviewPermissionSnapshot,
  type LegalAccessReviewSnapshot,
  type LegalAccessReviewSource,
} from "@/modules/legal/access-review";
import { enqueueNotification } from "@/modules/notifications/server/notifications";

type OrganizationRow = { id: string; last_scheduled_for: string | null };

type EffectiveAccessRow = {
  membership_id: string;
  user_id: string;
  display_name: string;
  email: string;
  permission_id: string;
  permission_key: string;
  effective_scope: string;
  sources: unknown;
};

type CreatedCampaign = {
  id: string;
  organizationId: string;
  dueAt: Date;
  snapshotItemCount: number;
};

export interface LegalAccessReviewWorkerSummary {
  organizationsChecked: number;
  campaignsCreated: number;
  itemsSnapshotted: number;
  notificationsEnqueued: number;
  notificationFailures: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeSources(value: unknown): LegalAccessReviewSource[] {
  if (!Array.isArray(value)) return [];
  const sources: LegalAccessReviewSource[] = [];
  for (const item of value) {
    const input = record(item);
    if (
      input.kind === "role" &&
      typeof input.roleId === "string" &&
      typeof input.roleKey === "string" &&
      typeof input.roleName === "string" &&
      typeof input.scope === "string"
    ) {
      sources.push({
        kind: "role",
        roleId: input.roleId,
        roleKey: input.roleKey,
        roleName: input.roleName,
        scope: input.scope,
      });
    } else if (
      input.kind === "override" &&
      input.effect === "allow" &&
      (typeof input.scope === "string" || input.scope === null) &&
      typeof input.reason === "string" &&
      (typeof input.expiresAt === "string" || input.expiresAt === null)
    ) {
      sources.push({
        kind: "override",
        effect: "allow",
        scope: input.scope,
        reason: input.reason,
        expiresAt: input.expiresAt,
      });
    }
  }
  return sources;
}

async function loadEffectiveSensitiveLegalAccess(
  sql: TransactionSql,
  organizationId: string,
): Promise<EffectiveAccessRow[]> {
  return sql<EffectiveAccessRow[]>`
    with effective_access as (
      select membership.id as membership_id, membership.user_id,
        coalesce(profile.display_name, identity_account.email) as display_name,
        identity_account.email, permission.id as permission_id,
        permission.key as permission_key,
        private.membership_effective_permission_scope(
          membership.id, permission.key
        ) as effective_scope
      from public.memberships as membership
      join public.identity_accounts as identity_account on identity_account.id = membership.user_id
      left join public.profiles as profile on profile.id = membership.user_id
      cross join public.permissions as permission
      where membership.organization_id = ${organizationId}::uuid
        and membership.status = 'active'
        and permission.module = 'legal'
        and permission.is_sensitive
    )
    select effective.membership_id, effective.user_id, effective.display_name,
      effective.email, effective.permission_id, effective.permission_key,
      effective.effective_scope,
      coalesce((
        select jsonb_agg(source.evidence order by source.sort_order, source.source_id)
        from (
          select 1 as sort_order, role.id::text as source_id,
            jsonb_build_object(
              'kind', 'role', 'roleId', role.id, 'roleKey', role.key,
              'roleName', role.name, 'scope', role_permission.scope
            ) as evidence
          from public.membership_roles as assignment
          join public.roles as role
            on role.id = assignment.role_id
           and role.organization_id = ${organizationId}::uuid
           and role.status = 'active'
          join public.role_permissions as role_permission
            on role_permission.role_id = role.id
           and role_permission.permission_id = effective.permission_id
          where assignment.membership_id = effective.membership_id
          union all
          select 2 as sort_order, override_grant.permission_id::text as source_id,
            jsonb_build_object(
              'kind', 'override', 'effect', 'allow', 'scope', override_grant.scope,
              'reason', override_grant.reason, 'expiresAt', override_grant.expires_at
            ) as evidence
          from public.membership_permission_overrides as override_grant
          where override_grant.membership_id = effective.membership_id
            and override_grant.permission_id = effective.permission_id
            and override_grant.effect = 'allow'
            and (override_grant.expires_at is null or override_grant.expires_at > now())
        ) as source
      ), '[]'::jsonb) as sources
    from effective_access as effective
    where effective.effective_scope is not null
    order by effective.membership_id, effective.permission_key
  `;
}

function groupMemberSnapshots(rows: EffectiveAccessRow[], capturedAt: string) {
  const members = new Map<
    string,
    {
      membershipId: string;
      userId: string;
      displayName: string;
      email: string;
      snapshot: LegalAccessReviewSnapshot;
    }
  >();
  for (const row of rows) {
    let member = members.get(row.membership_id);
    if (!member) {
      member = {
        membershipId: row.membership_id,
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
        snapshot: { capturedAt, permissions: [] },
      };
      members.set(row.membership_id, member);
    }
    const permission: LegalAccessReviewPermissionSnapshot = {
      permissionId: row.permission_id,
      key: row.permission_key,
      effectiveScope: row.effective_scope,
      sources: normalizeSources(row.sources),
    };
    member.snapshot.permissions.push(permission);
  }
  return [...members.values()];
}

async function createCampaign(
  sql: TransactionSql,
  organization: OrganizationRow,
): Promise<CreatedCampaign | null> {
  const openedAt = new Date();
  const dueAt = legalAccessReviewDueAt(openedAt);
  const scheduledFor = legalAccessReviewNextScheduledFor(organization.last_scheduled_for);
  const members = groupMemberSnapshots(
    await loadEffectiveSensitiveLegalAccess(sql, organization.id),
    openedAt.toISOString(),
  );
  const campaigns = await sql<Array<{ id: string }>>`
    insert into public.legal_access_review_campaigns (
      organization_id, scheduled_for, opened_at, due_at, snapshot_item_count,
      created_source, created_by_membership_id
    ) values (
      ${organization.id}::uuid, ${scheduledFor}::date, ${openedAt}, ${dueAt},
      ${members.length}, 'worker', null
    )
    on conflict do nothing
    returning id
  `;
  const campaignId = campaigns[0]?.id;
  if (!campaignId) return null;

  for (const member of members) {
    await sql`
      insert into public.legal_access_review_items (
        organization_id, campaign_id, subject_membership_id, subject_user_id,
        subject_display_name, subject_email, access_snapshot, permission_count,
        snapshot_digest
      ) values (
        ${organization.id}::uuid, ${campaignId}::uuid, ${member.membershipId}::uuid,
        ${member.userId}::uuid, ${member.displayName}, ${member.email},
        ${sql.json(toJsonValue(member.snapshot))}, ${member.snapshot.permissions.length},
        ${"0".repeat(64)}
      )
    `;
  }
  await sql`
    insert into public.audit_events (
      organization_id, actor_user_id, actor_type, action, entity_type, entity_id,
      source, after_state, changed_fields, metadata
    ) values (
      ${organization.id}::uuid, null, 'system', 'legal.access_review.campaign_created',
      'legal_access_review_campaign', ${campaignId}, 'worker',
      ${sql.json(
        toJsonValue({
          scheduledFor,
          openedAt: openedAt.toISOString(),
          dueAt: dueAt.toISOString(),
          snapshotItemCount: members.length,
        }),
      )},
      ${["scheduledFor", "dueAt", "snapshotItemCount"]}::text[], '{}'::jsonb
    )
  `;
  return {
    id: campaignId,
    organizationId: organization.id,
    dueAt,
    snapshotItemCount: members.length,
  };
}

async function notifyCampaignReviewers(campaign: CreatedCampaign): Promise<{
  enqueued: number;
  failures: number;
}> {
  const database = getDatabaseClient();
  const reviewers = await database<Array<{ id: string }>>`
    select membership.id
    from public.memberships as membership
    where membership.organization_id = ${campaign.organizationId}::uuid
      and membership.status = 'active'
      and private.membership_effective_permission_scope(
        membership.id, ${legalAccessReviewPermissionKeys.manage}
      ) = 'organization'
      and private.membership_has_permission(
        membership.id, 'notifications.notification.view'
      )
    order by membership.created_at, membership.id
    limit ${legalAccessReviewNotificationRecipientLimit}
  `;
  let enqueued = 0;
  let failures = 0;
  for (const reviewer of reviewers) {
    try {
      await enqueueNotification({
        organizationId: campaign.organizationId,
        recipientMembershipId: reviewer.id,
        category: "security_alert",
        severity: "warning",
        title: "Legal access review opened",
        message: `${campaign.snapshotItemCount} privileged legal access entr${
          campaign.snapshotItemCount === 1 ? "y requires" : "ies require"
        } attestation by ${campaign.dueAt.toISOString().slice(0, 10)}.`,
        deepLink: "/legal#legal-access-reviews",
        sourceModule: "legal",
        sourceEntityType: "legal_access_review_campaign",
        sourceEntityId: campaign.id,
        dedupeKey: `legal-access-review:${campaign.id}`,
        externalDelivery: false,
      });
      enqueued += 1;
    } catch {
      failures += 1;
    }
  }
  return { enqueued, failures };
}

export async function runLegalAccessReviewWorker(): Promise<LegalAccessReviewWorkerSummary> {
  const database = getDatabaseClient();
  const result = await database.begin(async (sql) => {
    const organizations = await sql<OrganizationRow[]>`
      select organization.id,
        (select max(campaign.scheduled_for)::text
          from public.legal_access_review_campaigns as campaign
          where campaign.organization_id = organization.id) as last_scheduled_for
      from public.organizations as organization
      where organization.status = 'active'
        and exists (
          select 1 from public.memberships as membership
          where membership.organization_id = organization.id
            and membership.status = 'active'
        )
        and not exists (
          select 1 from public.legal_access_review_campaigns as open_campaign
          where open_campaign.organization_id = organization.id
            and open_campaign.completed_at is null
        )
        and (
          not exists (
            select 1 from public.legal_access_review_campaigns as prior_campaign
            where prior_campaign.organization_id = organization.id
          )
          or (select max(previous_campaign.scheduled_for)
              from public.legal_access_review_campaigns as previous_campaign
              where previous_campaign.organization_id = organization.id)
            <= current_date - 90
        )
      order by organization.created_at, organization.id
      limit ${legalAccessReviewWorkerCampaignLimit}
      for update of organization skip locked
    `;
    const campaigns: CreatedCampaign[] = [];
    for (const organization of organizations) {
      const campaign = await createCampaign(sql, organization);
      if (campaign) campaigns.push(campaign);
    }
    return { organizationsChecked: organizations.length, campaigns };
  });

  let notificationsEnqueued = 0;
  let notificationFailures = 0;
  for (const campaign of result.campaigns) {
    const notification = await notifyCampaignReviewers(campaign);
    notificationsEnqueued += notification.enqueued;
    notificationFailures += notification.failures;
  }
  return {
    organizationsChecked: result.organizationsChecked,
    campaignsCreated: result.campaigns.length,
    itemsSnapshotted: result.campaigns.reduce(
      (total, campaign) => total + campaign.snapshotItemCount,
      0,
    ),
    notificationsEnqueued,
    notificationFailures,
  };
}
