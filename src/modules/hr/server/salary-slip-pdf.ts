import "server-only";

import { renderHtmlToPdf } from "@/lib/server/html-to-pdf";
import { formatMinorMoney } from "@/modules/finance/calculations";
import { escapeHtml } from "@/modules/finance/pdf/html";
import type { SalaryComponentInput, SalaryTotals } from "@/modules/hr/salary";

export interface SalarySlipPdfInput {
  organizationName: string;
  employeeName: string;
  employeeNumber: string | null;
  designationName: string | null;
  periodStart: string;
  periodEnd: string;
  currency: string;
  totals: SalaryTotals;
  allowances: readonly SalaryComponentInput[];
  deductions: readonly SalaryComponentInput[];
  notes: string | null;
  salaryRevisionNumber: number;
}

function money(value: number, currency: string): string {
  return formatMinorMoney(value, currency, "en-US");
}

function componentRows(
  items: readonly SalaryComponentInput[],
  currency: string,
  emptyLabel: string,
): string {
  if (items.length === 0) {
    return `<tr><td>${escapeHtml(emptyLabel)}</td><td class="amount">${escapeHtml(money(0, currency))}</td></tr>`;
  }
  return items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.name)}</td><td class="amount">${escapeHtml(money(item.amountMinor, currency))}</td></tr>`,
    )
    .join("");
}

export async function renderSalarySlipPdf(input: SalarySlipPdfInput): Promise<Buffer> {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Salary slip</title>
<style>
@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#15202b;margin:0;font-size:12px}header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #173f5f;padding-bottom:14px;margin-bottom:20px}h1{margin:0;font-size:26px}h2{font-size:14px;margin:20px 0 8px}.muted{color:#5c6975}.confidential{font-weight:700;letter-spacing:.12em;color:#8a2d2d}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 28px;margin-bottom:18px}.meta div{display:flex;justify-content:space-between;border-bottom:1px solid #dfe5ea;padding:6px 0}.meta span:first-child{color:#5c6975}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #dfe5ea;text-align:left}th{background:#f3f6f8}.amount{text-align:right;font-variant-numeric:tabular-nums}.columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}.totals{margin-left:auto;margin-top:22px;width:52%}.totals tr:last-child{font-size:15px;font-weight:700;border-top:2px solid #173f5f}.notes{margin-top:22px;padding:12px;background:#f7f8fa;border-left:3px solid #173f5f;white-space:pre-wrap}footer{margin-top:32px;border-top:1px solid #dfe5ea;padding-top:10px;color:#66737f;font-size:10px}.page-break{break-inside:avoid}
</style></head><body>
<header><div><h1>${escapeHtml(input.organizationName)}</h1><p class="muted">Salary slip · Salary revision ${input.salaryRevisionNumber}</p></div><div class="confidential">CONFIDENTIAL</div></header>
<section class="meta">
<div><span>Employee</span><strong>${escapeHtml(input.employeeName)}</strong></div>
<div><span>Employee ID</span><strong>${escapeHtml(input.employeeNumber ?? "Not assigned")}</strong></div>
<div><span>Designation</span><strong>${escapeHtml(input.designationName ?? "Not assigned")}</strong></div>
<div><span>Pay period</span><strong>${escapeHtml(input.periodStart)} – ${escapeHtml(input.periodEnd)}</strong></div>
<div><span>Currency</span><strong>${escapeHtml(input.currency)}</strong></div>
<div><span>Base salary</span><strong>${escapeHtml(money(input.totals.baseSalaryMinor, input.currency))}</strong></div>
</section>
<section class="columns page-break"><div><h2>Earnings</h2><table><thead><tr><th>Description</th><th class="amount">Amount</th></tr></thead><tbody>
<tr><td>Base salary</td><td class="amount">${escapeHtml(money(input.totals.baseSalaryMinor, input.currency))}</td></tr>
${componentRows(input.allowances, input.currency, "Recurring allowances")}
${input.totals.bonusMinor ? `<tr><td>Bonus</td><td class="amount">${escapeHtml(money(input.totals.bonusMinor, input.currency))}</td></tr>` : ""}
${input.totals.reimbursementMinor ? `<tr><td>Reimbursement</td><td class="amount">${escapeHtml(money(input.totals.reimbursementMinor, input.currency))}</td></tr>` : ""}
</tbody></table></div><div><h2>Deductions</h2><table><thead><tr><th>Description</th><th class="amount">Amount</th></tr></thead><tbody>
${componentRows(input.deductions, input.currency, "No recurring deductions")}
${input.totals.deductionsMinor > input.deductions.reduce((sum, item) => sum + item.amountMinor, 0) ? `<tr><td>Additional deduction</td><td class="amount">${escapeHtml(money(input.totals.deductionsMinor - input.deductions.reduce((sum, item) => sum + item.amountMinor, 0), input.currency))}</td></tr>` : ""}
</tbody></table></div></section>
<table class="totals page-break"><tbody>
<tr><td>Gross pay</td><td class="amount">${escapeHtml(money(input.totals.grossMinor, input.currency))}</td></tr>
<tr><td>Total deductions</td><td class="amount">${escapeHtml(money(input.totals.deductionsMinor, input.currency))}</td></tr>
<tr><td>Net pay</td><td class="amount">${escapeHtml(money(input.totals.netMinor, input.currency))}</td></tr>
</tbody></table>
${input.notes ? `<div class="notes"><strong>Notes</strong><br>${escapeHtml(input.notes)}</div>` : ""}
<footer>This salary slip is private and intended only for the employee and explicitly authorized HR, owner, or auditor access. Download and acknowledgement events are recorded.</footer>
</body></html>`;
  return renderHtmlToPdf({ html, pageSize: "A4", landscape: false });
}
