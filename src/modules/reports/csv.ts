import type { ReportSection, ReportsWorkspaceData } from "@/modules/reports/reports";
import { buildReportDocumentCsv } from "@/modules/reports/report-document";

// Formula-safe cells are produced by escapeCsvCell inside report-document.ts.
export function buildReportCsv(data: ReportsWorkspaceData, section: ReportSection): string {
  void section;
  return buildReportDocumentCsv(data);
}
