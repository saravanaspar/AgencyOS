"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  getChangedOrganizationProfileFields,
  isOrganizationProfileVersionCurrent,
  organizationProfileAuditSnapshot,
  type OrganizationProfileValues,
} from "@/modules/organizations/organization-profile";
import {
  organizationProfileUpdateSchema,
  type OrganizationProfileActionState,
} from "@/modules/organizations/schemas/organization-profile";
import { organizationProfilePermissionKeys } from "@/modules/organizations/server/organization-profile";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

class OrganizationProfileError extends Error {}
class OrganizationProfileConflictError extends OrganizationProfileError {}

interface OrganizationRow {
  id: string;
  slug: string;
  legal_name: string;
  trading_name: string | null;
  country_code: string | null;
  timezone: string;
  default_currency: string;
  financial_year_start_month: number;
  updated_at: Date;
}

function mapValues(row: OrganizationRow): OrganizationProfileValues {
  return {
    legalName: row.legal_name,
    displayName: row.trading_name,
    countryCode: row.country_code,
    timezone: row.timezone,
    defaultCurrency: row.default_currency,
    financialYearStartMonth: row.financial_year_start_month,
  };
}

function actionError(message: string, conflict = false): OrganizationProfileActionState {
  return { status: "error", message, conflict };
}

export async function updateOrganizationProfileAction(
  _previousState: OrganizationProfileActionState,
  formData: FormData,
): Promise<OrganizationProfileActionState> {
  const parsed = organizationProfileUpdateSchema.safeParse({
    legalName: formData.get("legalName"),
    displayName: formData.get("displayName"),
    countryCode: formData.get("countryCode"),
    timezone: formData.get("timezone"),
    defaultCurrency: formData.get("defaultCurrency"),
    financialYearStartMonth: formData.get("financialYearStartMonth"),
    expectedUpdatedAt: formData.get("expectedUpdatedAt"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;

    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: {
        legalName: fieldErrors.legalName,
        displayName: fieldErrors.displayName,
        countryCode: fieldErrors.countryCode,
        timezone: fieldErrors.timezone,
        defaultCurrency: fieldErrors.defaultCurrency,
        financialYearStartMonth: fieldErrors.financialYearStartMonth,
      },
    };
  }

  const authorization = await authorizeCurrentUser([
    organizationProfilePermissionKeys.view,
    organizationProfilePermissionKeys.update,
  ]);

  if (!authorization.allowed) {
    return actionError(
      authorization.reason === "insufficient-permission"
        ? "You do not have permission to update the organization profile."
        : "Your session or organization access is no longer active.",
    );
  }

  const database = getDatabaseClient();
  const organizationId = authorization.context.membership.organizationId;
  const actorUserId = authorization.context.user.id;
  const actorMembershipId = authorization.context.membership.id;

  try {
    const result = await database.begin(async (sql) => {
      const rows = await sql<OrganizationRow[]>`
        select
          id,
          slug,
          legal_name,
          trading_name,
          country_code,
          timezone,
          default_currency,
          financial_year_start_month,
          updated_at
        from public.organizations
        where id = ${organizationId}::uuid
        limit 1
        for update
      `;
      const current = rows[0];

      if (!current) {
        throw new OrganizationProfileError("The organization profile is unavailable.");
      }

      if (!isOrganizationProfileVersionCurrent(parsed.data.expectedUpdatedAt, current.updated_at)) {
        throw new OrganizationProfileConflictError(
          "This profile changed in another tab or session. Reload the page before saving again.",
        );
      }

      const before = mapValues(current);
      const requested: OrganizationProfileValues = {
        legalName: parsed.data.legalName,
        displayName: parsed.data.displayName,
        countryCode: parsed.data.countryCode,
        timezone: parsed.data.timezone,
        defaultCurrency: parsed.data.defaultCurrency,
        financialYearStartMonth: parsed.data.financialYearStartMonth,
      };
      const changedFields = getChangedOrganizationProfileFields(before, requested);

      if (changedFields.length === 0) {
        return { changedFields, updatedAt: current.updated_at };
      }

      const updatedRows = await sql<OrganizationRow[]>`
        update public.organizations
        set
          legal_name = ${requested.legalName},
          trading_name = ${requested.displayName},
          country_code = ${requested.countryCode},
          timezone = ${requested.timezone},
          default_currency = ${requested.defaultCurrency},
          financial_year_start_month = ${requested.financialYearStartMonth}
        where id = ${organizationId}::uuid
        returning
          id,
          slug,
          legal_name,
          trading_name,
          country_code,
          timezone,
          default_currency,
          financial_year_start_month,
          updated_at
      `;
      const updated = updatedRows[0];

      if (!updated) {
        throw new OrganizationProfileError("The organization profile could not be saved.");
      }

      const after = mapValues(updated);

      await sql`
        insert into public.audit_events (
          organization_id,
          actor_user_id,
          action,
          entity_type,
          entity_id,
          source,
          before_state,
          after_state,
          changed_fields,
          metadata
        )
        values (
          ${organizationId}::uuid,
          ${actorUserId}::uuid,
          'organization.profile_updated',
          'organization',
          ${organizationId},
          'web',
          ${sql.json(organizationProfileAuditSnapshot(before))},
          ${sql.json(organizationProfileAuditSnapshot(after))},
          ${changedFields}::text[],
          ${sql.json({ actorMembershipId, immutableSlug: current.slug })}
        )
      `;

      return { changedFields, updatedAt: updated.updated_at };
    });

    revalidatePath("/settings");
    revalidatePath("/settings/organization");
    revalidatePath("/dashboard");

    return {
      status: "success",
      message:
        result.changedFields.length === 0
          ? "No organization changes were needed."
          : `Organization profile updated (${result.changedFields.length} field${
              result.changedFields.length === 1 ? "" : "s"
            }).`,
    };
  } catch (error) {
    if (error instanceof OrganizationProfileConflictError) {
      return actionError(error.message, true);
    }

    return actionError(
      error instanceof OrganizationProfileError
        ? error.message
        : "The organization profile could not be updated. Try again.",
    );
  }
}
