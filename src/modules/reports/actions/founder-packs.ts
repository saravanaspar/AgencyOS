"use server";

import { redirect } from "next/navigation";

import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { ensureFounderReportSchedulesForContext } from "@/modules/reports/server/founder-packs";
import { generateReportSnapshot } from "@/modules/reports/server/report-snapshots";

export async function generateFounderWeeklyReviewAction(): Promise<never> {
  const authorization = await authorizeCurrentUser([
    "reports.workspace.view",
    "reports.founder_pack.view",
    "reports.snapshot.create",
    "reports.snapshot.download",
  ]);
  if (!authorization.allowed) redirect("/reports?section=founder_weekly&error=permission");
  const systemReports = await ensureFounderReportSchedulesForContext(authorization.context);
  if (!systemReports) redirect("/reports?section=founder_weekly&error=setup");
  const snapshot = await generateReportSnapshot(authorization.context, {
    savedViewId: systemReports.weeklyViewId,
    format: "pdf",
  });
  redirect(`/api/reports/snapshots/${snapshot.id}`);
}
