import { NextResponse } from "next/server";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { getRequestSecurityContextFromRequest } from "@/lib/server/request-context";
import { buildReportDocument } from "@/modules/reports/report-document";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { buildReportCsv } from "@/modules/reports/csv";
import { reportSections, reportsPermissionKeys } from "@/modules/reports/reports";
import { reportsFiltersSchema } from "@/modules/reports/schemas/reports";
import { getSavedReportViewForContext } from "@/modules/reports/server/report-studio";
import { auditReportExport, getReportsWorkspaceData } from "@/modules/reports/server/reports";
import {
  authorizationStatus,
  authorizeCurrentUser,
} from "@/modules/permissions/server/authorization";
import { authorizedRateLimitAllows } from "@/modules/security/server/security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await authorizeCurrentUser([
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.export,
  ]);
  if (!authorization.allowed) {
    return NextResponse.json(
      { error: authorization.reason },
      {
        status: authorizationStatus(authorization.reason),
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }

  const rateAllowed = await authorizedRateLimitAllows({
    kind: "export",
    context: authorization.context,
    request: getRequestSecurityContextFromRequest(request),
  });
  if (!rateAllowed) {
    return NextResponse.json(
      { error: "rate-limit-exceeded" },
      { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
    );
  }

  const url = new URL(request.url);
  const requestedViewId = url.searchParams.get("view");
  const savedView = requestedViewId
    ? await getSavedReportViewForContext(
        getDatabaseClient(),
        authorization.context,
        requestedViewId,
      )
    : null;
  if (requestedViewId && !savedView) {
    return NextResponse.json(
      { error: "report-view-not-found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const filters = savedView
    ? savedView.filters
    : reportsFiltersSchema.parse(Object.fromEntries(url.searchParams.entries()));
  const result = await getReportsWorkspaceData(filters, {
    widgetKeys: savedView?.widgetKeys,
    savedViewId: savedView?.id ?? null,
  });
  if (!result.allowed) {
    return NextResponse.json(
      { error: result.reason },
      {
        status: authorizationStatus(result.reason),
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  const section = reportSections.includes(filters.section) ? filters.section : "overview";
  if (!result.data.capabilities.sections.includes(section)) {
    return NextResponse.json(
      { error: "insufficient-source-permission" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (section === "hr" && !authorization.context.permissions.has(hrPermissionKeys.reportExport)) {
    return NextResponse.json(
      { error: "hr-export-permission-required" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const csv = buildReportCsv(result.data, section);
  const rowCount = buildReportDocument(result.data).rowCount;
  await auditReportExport(getDatabaseClient(), authorization.context, {
    section,
    filters: result.data.filters,
    rowCount,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agencyos-${section}-${result.data.filters.from}-${result.data.filters.to}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
