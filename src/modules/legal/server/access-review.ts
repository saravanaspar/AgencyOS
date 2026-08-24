import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  legalAccessReviewIsOverdue,
  legalAccessReviewPermissionKeys,
  type LegalAccessReviewDecision,
  type LegalAccessReviewPermissionSnapshot,
  type LegalAccessReviewSnapshot,
  type LegalAccessReviewSource,
} from "@/modules/legal/access-review";
import { legalPermissionKeys } from "@/modules/legal/legal";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export interface LegalAccessReviewItemSummary {
  id: string;
  subjectMembershipId: string;
  subjectDisplayName: string;
  subjectEmail: string;
  permissionCount: number;
  permissions: LegalAccessReviewPermissionSnapshot[];
  snapshotDigest: string;
  isSelf: boolean;
  attestation: {
    id: string;
    decision: LegalAccessReviewDecision;
    rationale: string;
    selfReview: boolean;
    reviewerName: string;
    attestationDigest: string;
    attestedAt: string;
  } | null;
}

export interface LegalAccessReviewCampaignSummary {
  id: string;
  scheduledFor: string;
  openedAt: string;
  dueAt: string;
  status: "open" | "overdue" | "completed";
  snapshotItemCount: number;
  attestedItemCount: number;
  completedAt: string | null;
  completedByName: string | null;
  evidenceDigest: string | null;
  retainCount: number;
  revokeCount: number;
  selfReviewCount: number;
  items: LegalAccessReviewItemSummary[];
  canComplete: boolean;
}

export interface LegalAccessReviewWorkspaceData {
  campaigns: LegalAccessReviewCampaignSummary[];
  capabilities: { canManage: boolean };
  cadenceDays: number;
  windowDays: number;
}

export type LegalAccessReviewWorkspaceResult =
  | { allowed: true; data: LegalAccessReviewWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

type CampaignRow = {
  id: string;
  scheduled_for: string;
  opened_at: Date;
  due_at: Date;
  snapshot_item_count: number;
  completed_at: Date | null;
  completed_by_name: string | null;
  evidence_digest: string | null;
  item_count: number | null;
  retain_count: number | null;
  revoke_count: number | null;
  self_review_count: number | null;
  attested_item_count: number;
};

type ItemRow = {
  id: string;
  campaign_id: string;
  subject_membership_id: string;
  subject_display_name: string;
  subject_email: string;
  access_snapshot: unknown;
  permission_count: number;
  snapshot_digest: string;
  attestation_id: string | null;
  decision: LegalAccessReviewDecision | null;
  rationale: string | null;
  self_review: boolean | null;
  reviewer_name: string | null;
  attestation_digest: string | null;
  attested_at: Date | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function source(value: unknown): LegalAccessReviewSource | null {
  const input = record(value);
  if (
    input.kind === "role" &&
    typeof input.roleId === "string" &&
    typeof input.roleKey === "string" &&
    typeof input.roleName === "string" &&
    typeof input.scope === "string"
  ) {
    return {
      kind: "role",
      roleId: input.roleId,
      roleKey: input.roleKey,
      roleName: input.roleName,
      scope: input.scope,
    };
  }
  if (
    input.kind === "override" &&
    input.effect === "allow" &&
    (typeof input.scope === "string" || input.scope === null) &&
    typeof input.reason === "string" &&
    (typeof input.expiresAt === "string" || input.expiresAt === null)
  ) {
    return {
      kind: "override",
      effect: "allow",
      scope: input.scope,
      reason: input.reason,
      expiresAt: input.expiresAt,
    };
  }
  return null;
}

function permission(value: unknown): LegalAccessReviewPermissionSnapshot | null {
  const input = record(value);
  if (
    typeof input.permissionId !== "string" ||
    typeof input.key !== "string" ||
    typeof input.effectiveScope !== "string" ||
    !Array.isArray(input.sources)
  ) {
    return null;
  }
  return {
    permissionId: input.permissionId,
    key: input.key,
    effectiveScope: input.effectiveScope,
    sources: input.sources
      .map(source)
      .filter((item): item is LegalAccessReviewSource => item !== null),
  };
}

export function normalizeLegalAccessReviewSnapshot(value: unknown): LegalAccessReviewSnapshot {
  const input = record(value);
  return {
    capturedAt: typeof input.capturedAt === "string" ? input.capturedAt : "",
    permissions: Array.isArray(input.permissions)
      ? input.permissions
          .map(permission)
          .filter((item): item is LegalAccessReviewPermissionSnapshot => item !== null)
      : [],
  };
}

export async function getLegalAccessReviewWorkspaceData(): Promise<LegalAccessReviewWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const context = permissionResult.context;
  if (
    !context.permissions.has(legalPermissionKeys.workspace) ||
    !context.permissions.has(legalAccessReviewPermissionKeys.view)
  ) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const canManage =
    context.permissions.has(legalAccessReviewPermissionKeys.manage) &&
    context.permissionScopes.get(legalAccessReviewPermissionKeys.manage) === "organization";

  try {
    const campaigns = await database<CampaignRow[]>`
      select campaign.id, campaign.scheduled_for::text, campaign.opened_at, campaign.due_at,
        campaign.snapshot_item_count, campaign.completed_at,
        coalesce(completer_profile.display_name, completer_account.email) as completed_by_name,
        completion.evidence_digest, completion.item_count, completion.retain_count,
        completion.revoke_count, completion.self_review_count,
        (select count(*)::integer
          from public.legal_access_review_attestations as attestation
          where attestation.organization_id = campaign.organization_id
            and attestation.campaign_id = campaign.id) as attested_item_count
      from public.legal_access_review_campaigns as campaign
      left join public.legal_access_review_completions as completion
        on completion.campaign_id = campaign.id
       and completion.organization_id = campaign.organization_id
      left join public.memberships as completer
        on completer.id = campaign.completed_by_membership_id
       and completer.organization_id = campaign.organization_id
      left join public.identity_accounts as completer_account on completer_account.id = completer.user_id
      left join public.profiles as completer_profile on completer_profile.id = completer.user_id
      where campaign.organization_id = ${organizationId}::uuid
      order by campaign.scheduled_for desc, campaign.id desc
      limit 12
    `;
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const items = campaignIds.length
      ? await database<ItemRow[]>`
          select item.id, item.campaign_id, item.subject_membership_id,
            item.subject_display_name, item.subject_email, item.access_snapshot,
            item.permission_count, item.snapshot_digest,
            attestation.id as attestation_id, attestation.decision,
            attestation.rationale, attestation.self_review,
            coalesce(reviewer_profile.display_name, reviewer_account.email) as reviewer_name,
            attestation.attestation_digest, attestation.attested_at
          from public.legal_access_review_items as item
          left join public.legal_access_review_attestations as attestation
            on attestation.item_id = item.id
           and attestation.campaign_id = item.campaign_id
           and attestation.organization_id = item.organization_id
          left join public.memberships as reviewer
            on reviewer.id = attestation.reviewer_membership_id
           and reviewer.organization_id = item.organization_id
          left join public.identity_accounts as reviewer_account on reviewer_account.id = reviewer.user_id
          left join public.profiles as reviewer_profile on reviewer_profile.id = reviewer.user_id
          where item.organization_id = ${organizationId}::uuid
            and item.campaign_id = any(${campaignIds}::uuid[])
          order by item.campaign_id, item.subject_display_name, item.id
        `
      : [];

    const itemMap = new Map<string, LegalAccessReviewItemSummary[]>();
    for (const item of items) {
      const list = itemMap.get(item.campaign_id) ?? [];
      const snapshot = normalizeLegalAccessReviewSnapshot(item.access_snapshot);
      list.push({
        id: item.id,
        subjectMembershipId: item.subject_membership_id,
        subjectDisplayName: item.subject_display_name,
        subjectEmail: item.subject_email,
        permissionCount: item.permission_count,
        permissions: snapshot.permissions,
        snapshotDigest: item.snapshot_digest,
        isSelf: item.subject_membership_id === context.membership.id,
        attestation:
          item.attestation_id &&
          item.decision &&
          item.rationale &&
          item.reviewer_name &&
          item.attestation_digest &&
          item.attested_at
            ? {
                id: item.attestation_id,
                decision: item.decision,
                rationale: item.rationale,
                selfReview: item.self_review ?? false,
                reviewerName: item.reviewer_name,
                attestationDigest: item.attestation_digest,
                attestedAt: item.attested_at.toISOString(),
              }
            : null,
      });
      itemMap.set(item.campaign_id, list);
    }

    return {
      allowed: true,
      data: {
        campaigns: campaigns.map((campaign) => ({
          id: campaign.id,
          scheduledFor: campaign.scheduled_for,
          openedAt: campaign.opened_at.toISOString(),
          dueAt: campaign.due_at.toISOString(),
          status: campaign.completed_at
            ? "completed"
            : legalAccessReviewIsOverdue(campaign.due_at, null)
              ? "overdue"
              : "open",
          snapshotItemCount: campaign.snapshot_item_count,
          attestedItemCount: campaign.attested_item_count,
          completedAt: campaign.completed_at?.toISOString() ?? null,
          completedByName: campaign.completed_by_name,
          evidenceDigest: campaign.evidence_digest,
          retainCount: campaign.retain_count ?? 0,
          revokeCount: campaign.revoke_count ?? 0,
          selfReviewCount: campaign.self_review_count ?? 0,
          items: itemMap.get(campaign.id) ?? [],
          canComplete:
            canManage &&
            campaign.completed_at === null &&
            campaign.attested_item_count === campaign.snapshot_item_count,
        })),
        capabilities: { canManage },
        cadenceDays: 90,
        windowDays: 14,
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
