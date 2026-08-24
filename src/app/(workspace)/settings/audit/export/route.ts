import type { NextRequest } from "next/server";

import { getRequestSecurityContextFromRequest } from "@/lib/server/request-context";
import { escapeCsvCell } from "@/modules/audit/audit-log-utils";
import { auditLogFiltersSchema } from "@/modules/audit/schemas/audit-log";
import { auditPermissionKeys, getAuditExportData } from "@/modules/audit/server/audit-log";
import {
  authorizationStatus,
  authorizeCurrentUser,
} from "@/modules/permissions/server/authorization";
import { authorizedRateLimitAllows } from "@/modules/security/server/security";

const csvColumns = [
  "occurred_at",
  "action",
  "actor_type",
  "actor_name",
  "actor_email",
  "entity_type",
  "entity_id",
  "source",
  "changed_fields",
  "before_state",
  "after_state",
  "metadata",
] as const;

export async function GET(request: NextRequest) {
  const rawFilters = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsedFilters = auditLogFiltersSchema.safeParse({ ...rawFilters, page: 1 });

  if (!parsedFilters.success) {
    return new Response("Invalid audit export filters.", { status: 400 });
  }

  const authorization = await authorizeCurrentUser([auditPermissionKeys.export]);
  if (!authorization.allowed) {
    return new Response(
      authorization.reason === "signed-out"
        ? "Authentication required."
        : "Audit export is not allowed.",
      { status: authorizationStatus(authorization.reason) },
    );
  }
  const rateAllowed = await authorizedRateLimitAllows({
    kind: "export",
    context: authorization.context,
    request: getRequestSecurityContextFromRequest(request),
  });
  if (!rateAllowed) {
    return new Response("Export rate limit exceeded or temporarily unavailable.", {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": "60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const result = await getAuditExportData(parsedFilters.data);

  if (!result.allowed) {
    return new Response(
      result.reason === "signed-out" ? "Authentication required." : "Audit export is not allowed.",
      { status: authorizationStatus(result.reason) },
    );
  }

  const rows = result.events.map((event) =>
    [
      event.occurredAt,
      event.action,
      event.actorType,
      event.actorDisplayName,
      event.actorEmail,
      event.entityType,
      event.entityId,
      event.source,
      event.changedFields.join("|"),
      JSON.stringify(event.beforeState),
      JSON.stringify(event.afterState),
      JSON.stringify(event.metadata),
    ]
      .map(escapeCsvCell)
      .join(","),
  );

  if (result.truncated) {
    rows.push(
      [
        "",
        "export.truncated",
        "system",
        "AgencyOS",
        "",
        "audit_export",
        "",
        "web",
        "",
        "",
        "",
        JSON.stringify({ message: "Export limited to 5000 most recent matching events." }),
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }

  const csv = [`\uFEFF${csvColumns.map(escapeCsvCell).join(",")}`, ...rows].join("\r\n");
  const timestamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="agencyos-audit-${timestamp}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
