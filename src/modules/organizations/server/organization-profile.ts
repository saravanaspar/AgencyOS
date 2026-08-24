import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

export const organizationProfilePermissionKeys = {
  view: "settings.organization.view",
  update: "settings.organization.update",
} as const;

export interface OrganizationProfileData {
  id: string;
  slug: string;
  status: "active" | "archived" | "suspended";
  legalName: string;
  displayName: string | null;
  countryCode: string | null;
  timezone: string;
  defaultCurrency: string;
  financialYearStartMonth: number;
  updatedAt: string;
  canUpdate: boolean;
}

export type OrganizationProfileResult =
  | { allowed: true; data: OrganizationProfileData }
  | { allowed: false; reason: AuthorizationFailureReason };

interface OrganizationRow {
  id: string;
  slug: string;
  status: "active" | "archived" | "suspended";
  legal_name: string;
  trading_name: string | null;
  country_code: string | null;
  timezone: string;
  default_currency: string;
  financial_year_start_month: number;
  updated_at: Date;
}

export async function getOrganizationProfileData(): Promise<OrganizationProfileResult> {
  const authorization = await authorizeCurrentUser([organizationProfilePermissionKeys.view]);

  if (!authorization.allowed) {
    return authorization;
  }

  const database = getDatabaseClient();
  const organizationId = authorization.context.membership.organizationId;

  try {
    const rows = await database<OrganizationRow[]>`
      select
        id,
        slug,
        status,
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
    `;
    const organization = rows[0];

    if (!organization) {
      return { allowed: false, reason: "access-check-failed" };
    }

    return {
      allowed: true,
      data: {
        id: organization.id,
        slug: organization.slug,
        status: organization.status,
        legalName: organization.legal_name,
        displayName: organization.trading_name,
        countryCode: organization.country_code,
        timezone: organization.timezone,
        defaultCurrency: organization.default_currency,
        financialYearStartMonth: organization.financial_year_start_month,
        updatedAt: organization.updated_at.toISOString(),
        canUpdate: authorization.context.permissions.has(organizationProfilePermissionKeys.update),
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
