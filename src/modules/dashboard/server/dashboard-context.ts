import "server-only";

import type { Sql } from "postgres";

import type { DashboardMode } from "@/modules/dashboard/dashboard";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

interface OrganizationRow {
  default_currency: string;
  number_format: string;
}

function dashboardMode(context: CurrentPermissionContext): DashboardMode {
  if (context.permissions.has("reports.founder_pack.view")) return "owner";
  if (context.permissions.has("reports.management_pack.view")) return "manager";
  return "employee";
}

export async function loadDashboardContext(database: Sql, context: CurrentPermissionContext) {
  const organizations = await database<OrganizationRow[]>`
    select default_currency, number_format
    from public.organizations where id = ${context.membership.organizationId}::uuid limit 1
  `;
  return {
    organization: organizations[0] ?? { default_currency: "USD", number_format: "en-US" },
    mode: dashboardMode(context),
  };
}
