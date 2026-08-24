import type { NextRequest } from "next/server";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { getRequestSecurityContextFromRequest } from "@/lib/server/request-context";
import { escapeCsvCell } from "@/modules/audit/audit-log-utils";
import { currencyMinorUnits } from "@/modules/finance/calculations";
import { financePermissionKeys } from "@/modules/finance/finance";
import { parseFinanceFilters } from "@/modules/finance/schemas/finance";
import {
  auditFinanceClientStatementExport,
  getFinanceClientStatementExport,
} from "@/modules/finance/server/reports";
import {
  authorizationStatus,
  authorizeCurrentUser,
} from "@/modules/permissions/server/authorization";
import { reportsPermissionKeys } from "@/modules/reports/reports";
import { authorizedRateLimitAllows } from "@/modules/security/server/security";

const clientStatementColumns = [
  "date",
  "entry_type",
  "reference",
  "description",
  "debit",
  "credit",
  "balance",
  "currency",
] as const;

function minorToDecimal(amountMinor: number, currency: string): string {
  const places = currencyMinorUnits(currency);
  const divisor = 10 ** places;
  return (amountMinor / divisor).toFixed(places);
}

export async function GET(request: NextRequest) {
  const filters = parseFinanceFilters({
    ...Object.fromEntries(request.nextUrl.searchParams.entries()),
    tab: "reports",
  });
  const authorization = await authorizeCurrentUser([
    financePermissionKeys.reportView,
    reportsPermissionKeys.export,
  ]);
  if (!authorization.allowed) {
    return new Response(
      authorization.reason === "signed-out"
        ? "Authentication required."
        : "Client statement export is not allowed.",
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

  const result = await getFinanceClientStatementExport(filters);

  if (!result.allowed) {
    if (result.reason === "company-required") {
      return new Response("Choose a client before exporting a statement.", { status: 400 });
    }
    if (result.reason === "not-found") {
      return new Response("Client statement not found.", { status: 404 });
    }
    return new Response(
      result.reason === "signed-out"
        ? "Authentication required."
        : "Client statement export is not allowed.",
      { status: authorizationStatus(result.reason) },
    );
  }

  if (result.statement.isTruncated) {
    return new Response("The statement exceeds 5,000 rows. Choose a narrower date range.", {
      status: 413,
    });
  }

  const rows = result.statement.entries.map((entry) =>
    [
      entry.date,
      entry.entryType,
      entry.reference,
      entry.description,
      minorToDecimal(entry.debitMinor, result.currency),
      minorToDecimal(entry.creditMinor, result.currency),
      minorToDecimal(entry.balanceMinor, result.currency),
      result.currency,
    ]
      .map(escapeCsvCell)
      .join(","),
  );

  rows.unshift(
    [
      result.period.from,
      "opening_balance",
      "",
      result.statement.companyName,
      "",
      "",
      minorToDecimal(result.statement.openingBalanceMinor, result.currency),
      result.currency,
    ]
      .map(escapeCsvCell)
      .join(","),
  );

  const csv = [`\uFEFF${clientStatementColumns.map(escapeCsvCell).join(",")}`, ...rows].join(
    "\r\n",
  );
  await auditFinanceClientStatementExport(getDatabaseClient(), authorization.context, {
    companyId: result.statement.companyId,
    from: result.period.from,
    to: result.period.to,
    rowCount: rows.length,
  });
  return new Response(csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="agencyos-client-statement-${result.period.from}-${result.period.to}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
