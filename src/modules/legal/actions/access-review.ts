"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { legalAccessReviewPermissionKeys } from "@/modules/legal/access-review";
import { legalPermissionKeys } from "@/modules/legal/legal";
import {
  legalAccessReviewAttestationSchema,
  legalAccessReviewCompletionSchema,
  type LegalAccessReviewActionState,
} from "@/modules/legal/schemas/access-review";
import { normalizeLegalAccessReviewSnapshot } from "@/modules/legal/server/access-review";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { requireRecentReauthentication } from "@/modules/security/server/security";

class LegalAccessReviewActionError extends Error {}

type ReviewItemRow = {
  id: string;
  campaign_id: string;
  subject_membership_id: string;
  access_snapshot: unknown;
  snapshot_digest: string;
  campaign_completed_at: Date | null;
};

type OverrideRow = {
  permission_id: string;
  permission_key: string;
  effect: "allow" | "deny" | null;
  scope: string | null;
  reason: string | null;
  expires_at: Date | null;
};

function failure(
  message: string,
  fieldErrors?: Record<string, string[]>,
): LegalAccessReviewActionState {
  return { status: "error", message, fieldErrors };
}

function success(message: string): LegalAccessReviewActionState {
  return { status: "success", message };
}

async function requireLegalAccessReviewManager(): Promise<CurrentPermissionContext> {
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    legalAccessReviewPermissionKeys.view,
    legalAccessReviewPermissionKeys.manage,
  ]);
  if (!authorization.allowed) {
    throw new LegalAccessReviewActionError("You cannot manage legal access reviews.");
  }
  if (
    authorization.context.permissionScopes.get(legalAccessReviewPermissionKeys.manage) !==
    "organization"
  ) {
    throw new LegalAccessReviewActionError(
      "Legal access reviews require organization-wide management scope.",
    );
  }
  await requireRecentReauthentication(authorization.context);
  return authorization.context;
}

function refresh() {
  revalidatePath("/legal");
  revalidatePath("/settings/roles");
  revalidatePath("/settings/permissions");
}

function actionError(error: unknown, fallback: string): LegalAccessReviewActionState {
  return failure(error instanceof LegalAccessReviewActionError ? error.message : fallback);
}

export async function attestLegalAccessReviewAction(
  _previous: LegalAccessReviewActionState,
  formData: FormData,
): Promise<LegalAccessReviewActionState> {
  const parsed = legalAccessReviewAttestationSchema.safeParse({
    campaignId: formData.get("campaignId"),
    itemId: formData.get("itemId"),
    snapshotDigest: formData.get("snapshotDigest"),
    decision: formData.get("decision"),
    rationale: formData.get("rationale"),
    selfReviewAcknowledged: formData.get("selfReviewAcknowledged"),
  });
  if (!parsed.success) {
    return failure("Check the access-review attestation.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await requireLegalAccessReviewManager();
    const organizationId = context.membership.organizationId;
    await getDatabaseClient().begin(async (sql) => {
      const items = await sql<ReviewItemRow[]>`
        select item.id, item.campaign_id, item.subject_membership_id,
          item.access_snapshot, item.snapshot_digest,
          campaign.completed_at as campaign_completed_at
        from public.legal_access_review_items as item
        join public.legal_access_review_campaigns as campaign
          on campaign.id = item.campaign_id
         and campaign.organization_id = item.organization_id
        where item.id = ${parsed.data.itemId}::uuid
          and item.campaign_id = ${parsed.data.campaignId}::uuid
          and item.organization_id = ${organizationId}::uuid
        for update of item, campaign
      `;
      const item = items[0];
      if (!item) throw new LegalAccessReviewActionError("Access-review item not found.");
      if (item.campaign_completed_at) {
        throw new LegalAccessReviewActionError("This access-review campaign is already complete.");
      }
      if (item.snapshot_digest !== parsed.data.snapshotDigest) {
        throw new LegalAccessReviewActionError(
          "The access snapshot changed. Reload and try again.",
        );
      }
      const priorAttestations = await sql<Array<{ id: string }>>`
        select id from public.legal_access_review_attestations
        where organization_id = ${organizationId}::uuid
          and campaign_id = ${item.campaign_id}::uuid
          and item_id = ${item.id}::uuid
        limit 1
      `;
      if (priorAttestations[0]) {
        throw new LegalAccessReviewActionError("This access-review item is already attested.");
      }

      const selfReview = item.subject_membership_id === context.membership.id;
      if (selfReview !== parsed.data.selfReviewAcknowledged) {
        throw new LegalAccessReviewActionError(
          selfReview
            ? "Explicitly acknowledge that this is a self-review before attesting."
            : "Self-review acknowledgement is valid only for your own access.",
        );
      }

      const snapshot = normalizeLegalAccessReviewSnapshot(item.access_snapshot);
      const permissionIds = snapshot.permissions.map((permission) => permission.permissionId);
      if (permissionIds.length === 0) {
        throw new LegalAccessReviewActionError(
          "The access snapshot has no reviewable permissions.",
        );
      }

      let revocationSnapshot: Record<string, unknown> = {};
      if (parsed.data.decision === "revoke") {
        if (
          selfReview &&
          snapshot.permissions.some(
            (permission) => permission.key === legalAccessReviewPermissionKeys.manage,
          )
        ) {
          const alternateManagers = await sql<Array<{ id: string }>>`
            select membership.id
            from public.memberships as membership
            where membership.organization_id = ${organizationId}::uuid
              and membership.status = 'active'
              and membership.id <> ${context.membership.id}::uuid
              and private.membership_effective_permission_scope(
                membership.id, ${legalAccessReviewPermissionKeys.manage}
              ) = 'organization'
            limit 1
          `;
          if (!alternateManagers[0]) {
            throw new LegalAccessReviewActionError(
              "Add another organization-wide legal access reviewer before revoking your own review authority.",
            );
          }
        }

        const beforeOverrides = await sql<OverrideRow[]>`
          select permission.id as permission_id, permission.key as permission_key,
            override_grant.effect, override_grant.scope, override_grant.reason,
            override_grant.expires_at
          from public.permissions as permission
          left join public.membership_permission_overrides as override_grant
            on override_grant.permission_id = permission.id
           and override_grant.membership_id = ${item.subject_membership_id}::uuid
          where permission.id = any(${permissionIds}::uuid[])
            and permission.module = 'legal'
            and permission.is_sensitive
          order by permission.key
        `;
        if (beforeOverrides.length !== permissionIds.length) {
          throw new LegalAccessReviewActionError("The access snapshot is no longer valid.");
        }
        const overrideReason =
          `Legal access review ${item.campaign_id}: ${parsed.data.rationale}`.slice(0, 300);
        for (const permission of beforeOverrides) {
          await sql`
            insert into public.membership_permission_overrides (
              membership_id, permission_id, effect, scope, conditions, reason,
              expires_at, granted_by
            ) values (
              ${item.subject_membership_id}::uuid, ${permission.permission_id}::uuid,
              'deny', null, '{}'::jsonb, ${overrideReason}, null, ${context.user.id}::uuid
            )
            on conflict (membership_id, permission_id) do update set
              effect = 'deny', scope = null, conditions = '{}'::jsonb,
              reason = excluded.reason, expires_at = null,
              granted_by = excluded.granted_by, updated_at = now()
          `;
        }
        revocationSnapshot = {
          overrides: beforeOverrides.map((permission) => ({
            permissionId: permission.permission_id,
            permissionKey: permission.permission_key,
            previous: permission.effect
              ? {
                  effect: permission.effect,
                  scope: permission.scope,
                  reason: permission.reason,
                  expiresAt: permission.expires_at?.toISOString() ?? null,
                }
              : null,
            applied: { effect: "deny", scope: null, expiresAt: null },
          })),
        };
      }

      const attestations = await sql<Array<{ id: string; attestation_digest: string }>>`
        insert into public.legal_access_review_attestations (
          organization_id, campaign_id, item_id, reviewer_membership_id,
          decision, rationale, self_review, reviewed_access_digest,
          revocation_snapshot, evidence_snapshot, attestation_digest
        ) values (
          ${organizationId}::uuid, ${item.campaign_id}::uuid, ${item.id}::uuid,
          ${context.membership.id}::uuid, ${parsed.data.decision}, ${parsed.data.rationale},
          ${selfReview}, ${item.snapshot_digest},
          ${sql.json(toJsonValue(revocationSnapshot))}, '{}'::jsonb, ${"0".repeat(64)}
        )
        returning id, attestation_digest
      `;
      const attestation = attestations[0];
      if (!attestation) throw new Error("Access-review attestation insert returned no row.");

      await writeAuditEvent(sql, context, {
        action: "legal.access_review.attested",
        entityType: "legal_access_review_item",
        entityId: item.id,
        afterState: {
          campaignId: item.campaign_id,
          subjectMembershipId: item.subject_membership_id,
          decision: parsed.data.decision,
          selfReview,
          snapshotDigest: item.snapshot_digest,
          attestationDigest: attestation.attestation_digest,
        },
        changedFields: ["attestation"],
      });
      if (parsed.data.decision === "revoke") {
        await writeAuditEvent(sql, context, {
          action: "legal.access_review.access_revoked",
          entityType: "membership",
          entityId: item.subject_membership_id,
          beforeState: { snapshotDigest: item.snapshot_digest },
          afterState: {
            permanentExplicitDeny: true,
            permissionKeys: snapshot.permissions.map((permission) => permission.key),
            campaignId: item.campaign_id,
          },
          changedFields: ["permissionOverrides"],
        });
      }
    });
    refresh();
    return success(
      parsed.data.decision === "revoke"
        ? "Access revoked with permanent explicit deny overrides and immutable evidence."
        : "Access retention attested with immutable evidence.",
    );
  } catch (error) {
    return actionError(error, "The access-review attestation could not be recorded.");
  }
}

export async function completeLegalAccessReviewAction(
  _previous: LegalAccessReviewActionState,
  formData: FormData,
): Promise<LegalAccessReviewActionState> {
  const parsed = legalAccessReviewCompletionSchema.safeParse({
    campaignId: formData.get("campaignId"),
  });
  if (!parsed.success) return failure("Invalid access-review completion request.");

  try {
    const context = await requireLegalAccessReviewManager();
    const organizationId = context.membership.organizationId;
    const completion = await getDatabaseClient().begin(async (sql) => {
      const campaigns = await sql<
        Array<{ id: string; completed_at: Date | null; snapshot_item_count: number }>
      >`
        select id, completed_at, snapshot_item_count
        from public.legal_access_review_campaigns
        where id = ${parsed.data.campaignId}::uuid
          and organization_id = ${organizationId}::uuid
        for update
      `;
      const campaign = campaigns[0];
      if (!campaign) throw new LegalAccessReviewActionError("Access-review campaign not found.");
      if (campaign.completed_at) {
        throw new LegalAccessReviewActionError("This access-review campaign is already complete.");
      }
      const completions = await sql<
        Array<{
          id: string;
          item_count: number;
          retain_count: number;
          revoke_count: number;
          self_review_count: number;
          evidence_digest: string;
          completed_at: Date;
        }>
      >`
        insert into public.legal_access_review_completions (
          organization_id, campaign_id, completed_by_membership_id, evidence_digest
        ) values (
          ${organizationId}::uuid, ${campaign.id}::uuid,
          ${context.membership.id}::uuid, ${"0".repeat(64)}
        )
        returning id, item_count, retain_count, revoke_count, self_review_count,
          evidence_digest, completed_at
      `;
      const result = completions[0];
      if (!result) throw new Error("Access-review completion insert returned no row.");
      await sql`
        update public.legal_access_review_campaigns
        set completed_at = ${result.completed_at},
          completed_by_membership_id = ${context.membership.id}::uuid
        where id = ${campaign.id}::uuid
          and organization_id = ${organizationId}::uuid
          and completed_at is null
      `;
      await writeAuditEvent(sql, context, {
        action: "legal.access_review.completed",
        entityType: "legal_access_review_campaign",
        entityId: campaign.id,
        afterState: {
          itemCount: result.item_count,
          retainCount: result.retain_count,
          revokeCount: result.revoke_count,
          selfReviewCount: result.self_review_count,
          evidenceDigest: result.evidence_digest,
          completedAt: result.completed_at.toISOString(),
        },
        changedFields: ["completion"],
      });
      return result;
    });
    refresh();
    return success(
      `Access review completed: ${completion.retain_count} retained, ${completion.revoke_count} revoked.`,
    );
  } catch (error) {
    return actionError(error, "Complete every access-review item before closing this campaign.");
  }
}
