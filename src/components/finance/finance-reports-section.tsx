"use client";

import Link from "next/link";
import {
  BadgeCheck,
  Banknote,
  Download,
  FileBarChart2,
  Landmark,
  ReceiptText,
  Scale,
  Percent,
} from "lucide-react";

import { formatMinorMoney } from "@/modules/finance/calculations";
import { financeStatusLabel } from "@/modules/finance/finance";
import type {
  FinanceClientStatementEntry,
  FinanceExpenseReportRow,
  FinanceProjectMargin,
  FinanceRevenueClient,
  FinanceRevenueMonth,
  FinanceRevenueService,
  FinanceWorkspaceData,
} from "@/modules/finance/server/finance";
import { getDateTimeFormatter, getNumberFormatter } from "@/lib/intl-formatters";
import { CashForecastSection } from "@/components/finance/cash-forecast-section";
import { CollectionsSection } from "@/components/finance/collections-section";

function formatMonth(value: string, locale: string): string {
  const [year, month] = value.split("-").map(Number);
  return getDateTimeFormatter(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatQuantity(quantityMilli: number, locale: string): string {
  return getNumberFormatter(locale, { maximumFractionDigits: 3 }).format(quantityMilli / 1_000);
}

function barWidth(value: number, maximum: number): string {
  if (maximum <= 0 || value <= 0) return "0%";
  return `${Math.max(3, Math.round((value / maximum) * 100))}%`;
}

function RevenueMonthRows({
  rows,
  data,
}: {
  rows: FinanceRevenueMonth[];
  data: FinanceWorkspaceData;
}) {
  const maximum = Math.max(0, ...rows.map((row) => row.revenueMinor));
  return (
    <ul className="finance-report-bars" aria-label="Revenue by month">
      {rows.map((row) => (
        <li key={row.month} className="finance-report-bar">
          <span>{formatMonth(row.month, data.locale)}</span>
          <div aria-hidden="true">
            <i style={{ width: barWidth(row.revenueMinor, maximum) }} />
          </div>
          <strong>{formatMinorMoney(row.revenueMinor, data.defaultCurrency, data.locale)}</strong>
        </li>
      ))}
    </ul>
  );
}

function ClientRevenueRows({
  rows,
  data,
}: {
  rows: FinanceRevenueClient[];
  data: FinanceWorkspaceData;
}) {
  return (
    <div className="finance-report-table-scroll">
      <table className="finance-report-table">
        <caption className="sr-only">Revenue by client</caption>
        <thead>
          <tr>
            <th scope="col">Client</th>
            <th scope="col">Invoices</th>
            <th scope="col">Credits</th>
            <th scope="col">Net revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.companyId}>
              <th scope="row">{row.companyName}</th>
              <td>{formatMinorMoney(row.invoiceMinor, data.defaultCurrency, data.locale)}</td>
              <td>{formatMinorMoney(row.creditMinor, data.defaultCurrency, data.locale)}</td>
              <td>
                <strong>
                  {formatMinorMoney(row.netRevenueMinor, data.defaultCurrency, data.locale)}
                </strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectMarginRows({
  rows,
  data,
}: {
  rows: FinanceProjectMargin[];
  data: FinanceWorkspaceData;
}) {
  return (
    <div className="finance-report-table-scroll">
      <table className="finance-report-table">
        <caption className="sr-only">Project gross profit</caption>
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Revenue</th>
            <th scope="col">Expenses</th>
            <th scope="col">Gross profit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.projectId ?? "unassigned"}>
              <th scope="row">
                <strong>{row.projectName}</strong>
                <small>{row.projectCode ?? "No project assigned"}</small>
              </th>
              <td>{formatMinorMoney(row.revenueMinor, data.defaultCurrency, data.locale)}</td>
              <td>{formatMinorMoney(row.expenseMinor, data.defaultCurrency, data.locale)}</td>
              <td data-negative={row.grossProfitMinor < 0 || undefined}>
                <strong>
                  {formatMinorMoney(row.grossProfitMinor, data.defaultCurrency, data.locale)}
                </strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServiceRevenueRows({
  rows,
  data,
}: {
  rows: FinanceRevenueService[];
  data: FinanceWorkspaceData;
}) {
  return (
    <ol className="finance-ranked-list" aria-label="Revenue by service">
      {rows.map((row, index) => (
        <li key={`${row.catalogItemId ?? "custom"}-${row.itemName}`}>
          <span aria-hidden="true">{index + 1}</span>
          <div>
            <strong>{row.itemName}</strong>
            <small>{formatQuantity(row.quantityMilli, data.locale)} units net of credits</small>
          </div>
          <strong>{formatMinorMoney(row.revenueMinor, data.defaultCurrency, data.locale)}</strong>
        </li>
      ))}
    </ol>
  );
}

function ExpenseRows({
  rows,
  data,
  label,
}: {
  rows: FinanceExpenseReportRow[];
  data: FinanceWorkspaceData;
  label: string;
}) {
  return (
    <ol className="finance-ranked-list" aria-label={label}>
      {rows.map((row, index) => (
        <li key={row.id}>
          <span aria-hidden="true">{index + 1}</span>
          <div>
            <strong>{row.label}</strong>
            <small>
              {row.taxMinor > 0
                ? `${formatMinorMoney(row.taxMinor, data.defaultCurrency, data.locale)} tax included`
                : "No separately recorded tax"}
            </small>
          </div>
          <strong>{formatMinorMoney(row.totalMinor, data.defaultCurrency, data.locale)}</strong>
        </li>
      ))}
    </ol>
  );
}

function StatementEntryRows({
  entries,
  data,
}: {
  entries: FinanceClientStatementEntry[];
  data: FinanceWorkspaceData;
}) {
  return (
    <div className="finance-report-table-scroll">
      <table className="finance-statement-table">
        <caption className="sr-only">Client statement entries</caption>
        <thead>
          <tr>
            <th scope="col">Date and reference</th>
            <th scope="col">Debit</th>
            <th scope="col">Credit</th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <th scope="row">
                <strong>{entry.reference}</strong>
                <small>
                  {entry.date} · {financeStatusLabel(entry.entryType)} · {entry.description}
                </small>
              </th>
              <td>
                {entry.debitMinor
                  ? formatMinorMoney(entry.debitMinor, data.defaultCurrency, data.locale)
                  : "—"}
              </td>
              <td>
                {entry.creditMinor
                  ? formatMinorMoney(entry.creditMinor, data.defaultCurrency, data.locale)
                  : "—"}
              </td>
              <td>
                <strong>
                  {formatMinorMoney(entry.balanceMinor, data.defaultCurrency, data.locale)}
                </strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyReport({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="finance-empty finance-empty--compact">
      <BadgeCheck size={20} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

export function FinanceReportsSection({ data }: { data: FinanceWorkspaceData }) {
  if (!data.capabilities.canViewReports) {
    return (
      <section className="finance-section" aria-labelledby="reports-title">
        <div className="finance-empty">
          <FileBarChart2 size={22} aria-hidden="true" />
          <h2 id="reports-title">Financial reports are restricted</h2>
          <p>
            Your current role can use its permitted finance workflows but cannot view
            organization-wide financial reports.
          </p>
        </div>
      </section>
    );
  }

  const statement = data.clientStatement;

  return (
    <section className="finance-section finance-reports" aria-labelledby="reports-title">
      <div className="finance-section__heading">
        <div>
          <h2 id="reports-title">Financial reports</h2>
          <p>
            Issued documents, credits, collected cash, approved expenses, and tax evidence for{" "}
            {data.reportPeriod.from} through {data.reportPeriod.to}. Values use{" "}
            {data.defaultCurrency}; foreign-currency records remain excluded until converted.
          </p>
        </div>
      </div>

      <CashForecastSection data={data} />
      <CollectionsSection data={data} />

      <div className="finance-report-layout">
        <article className="finance-report-panel finance-report-panel--wide">
          <header>
            <div>
              <h3>Revenue by month</h3>
              <p>Issued invoice value less issued credit notes.</p>
            </div>
            <Banknote size={18} aria-hidden="true" />
          </header>
          {data.revenueByMonth.length ? (
            <RevenueMonthRows rows={data.revenueByMonth} data={data} />
          ) : (
            <EmptyReport
              title="No revenue in this period"
              detail="Adjust the report dates to include issued invoices."
            />
          )}
        </article>

        <article className="finance-report-panel">
          <header>
            <div>
              <h3>Revenue by service</h3>
              <p>Net line revenue after credit-note lines.</p>
            </div>
            <ReceiptText size={18} aria-hidden="true" />
          </header>
          {data.revenueByService.length ? (
            <ServiceRevenueRows rows={data.revenueByService} data={data} />
          ) : (
            <EmptyReport
              title="No service revenue"
              detail="Issued invoice lines will appear here."
            />
          )}
        </article>

        <article className="finance-report-panel">
          <header>
            <div>
              <h3>Collection and conversion</h3>
              <p>Fully paid invoice timing and estimates that reached a client decision.</p>
            </div>
            <Percent size={18} aria-hidden="true" />
          </header>
          <dl className="finance-report-ratios">
            <div>
              <dt>Average collection time</dt>
              <dd>
                {data.paymentCollection.averageDays === null
                  ? "No paid invoices"
                  : `${data.paymentCollection.averageDays} days`}
              </dd>
            </div>
            <div>
              <dt>Median collection time</dt>
              <dd>
                {data.paymentCollection.medianDays === null
                  ? "Not available"
                  : `${data.paymentCollection.medianDays} days`}
              </dd>
            </div>
            <div>
              <dt>Estimate conversion</dt>
              <dd>{(data.estimateConversion.rateBps / 100).toFixed(1)}%</dd>
              <small>
                {data.estimateConversion.convertedCount} converted of{" "}
                {data.estimateConversion.eligibleCount}
              </small>
            </div>
            <div>
              <dt>Converted estimate value</dt>
              <dd>
                {formatMinorMoney(
                  data.estimateConversion.convertedValueMinor,
                  data.defaultCurrency,
                  data.locale,
                )}
              </dd>
            </div>
          </dl>
        </article>

        <article className="finance-report-panel finance-report-panel--wide">
          <header>
            <div>
              <h3>Revenue by client</h3>
              <p>Invoice, credit, and net revenue totals for each client.</p>
            </div>
            <Landmark size={18} aria-hidden="true" />
          </header>
          {data.revenueByClient.length ? (
            <ClientRevenueRows rows={data.revenueByClient} data={data} />
          ) : (
            <EmptyReport
              title="No client revenue"
              detail="Issued client invoices will appear here."
            />
          )}
        </article>

        <article className="finance-report-panel finance-report-panel--wide">
          <header>
            <div>
              <h3>Project gross profit</h3>
              <p>Net project revenue less approved project allocations.</p>
            </div>
            <Scale size={18} aria-hidden="true" />
          </header>
          {data.projectMargins.length ? (
            <ProjectMarginRows rows={data.projectMargins} data={data} />
          ) : (
            <EmptyReport
              title="No project margin data"
              detail="Assign invoices and expenses to projects to compare margin."
            />
          )}
        </article>

        <article className="finance-report-panel">
          <header>
            <div>
              <h3>Expenses by category</h3>
              <p>Approved and no-approval-required expenses.</p>
            </div>
            <ReceiptText size={18} aria-hidden="true" />
          </header>
          {data.expenseByCategory.length ? (
            <ExpenseRows rows={data.expenseByCategory} data={data} label="Expenses by category" />
          ) : (
            <EmptyReport
              title="No approved expenses"
              detail="Approved expenses will appear here."
            />
          )}
        </article>

        <article className="finance-report-panel">
          <header>
            <div>
              <h3>Expenses by project</h3>
              <p>Project allocation value in the report period.</p>
            </div>
            <FileBarChart2 size={18} aria-hidden="true" />
          </header>
          {data.expenseByProject.length ? (
            <ExpenseRows rows={data.expenseByProject} data={data} label="Expenses by project" />
          ) : (
            <EmptyReport
              title="No project expenses"
              detail="Allocate approved expenses to projects to report them here."
            />
          )}
        </article>
      </div>

      <section className="finance-tax-summary" aria-labelledby="tax-summary-title">
        <header>
          <div>
            <h3 id="tax-summary-title">Tax summary</h3>
            <p>Output tax less issued credits and approved expense input tax.</p>
          </div>
          <Percent size={18} aria-hidden="true" />
        </header>
        <dl>
          <div>
            <dt>Invoice tax</dt>
            <dd>
              {formatMinorMoney(data.taxSummary.invoiceTaxMinor, data.defaultCurrency, data.locale)}
            </dd>
          </div>
          <div>
            <dt>Credit-note tax</dt>
            <dd>
              {formatMinorMoney(data.taxSummary.creditTaxMinor, data.defaultCurrency, data.locale)}
            </dd>
          </div>
          <div>
            <dt>Expense input tax</dt>
            <dd>
              {formatMinorMoney(data.taxSummary.expenseTaxMinor, data.defaultCurrency, data.locale)}
            </dd>
          </div>
          <div>
            <dt>Net tax position</dt>
            <dd data-negative={data.taxSummary.netTaxMinor < 0 || undefined}>
              {formatMinorMoney(data.taxSummary.netTaxMinor, data.defaultCurrency, data.locale)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="finance-client-statement" aria-labelledby="client-statement-title">
        <header>
          <div>
            <h3 id="client-statement-title">Client statement</h3>
            <p>
              Select a client in the filters to reconcile invoices, credits, payments, and refunds.
            </p>
          </div>
          {statement && !statement.isTruncated && data.capabilities.canExportReports ? (
            <Link className="button button--secondary button--sm" href={statement.downloadHref}>
              <Download size={15} aria-hidden="true" /> Download CSV
            </Link>
          ) : null}
        </header>
        {statement ? (
          <>
            {statement.isTruncated ? (
              <p className="finance-report-warning" role="status">
                This period has more than 5,000 statement entries. Totals include the full period,
                but the table is capped. Narrow the dates to enable a complete CSV export.
              </p>
            ) : null}
            <div className="finance-statement-summary">
              <div>
                <span>Client</span>
                <strong>{statement.companyName}</strong>
              </div>
              <div>
                <span>Opening balance</span>
                <strong>
                  {formatMinorMoney(
                    statement.openingBalanceMinor,
                    data.defaultCurrency,
                    data.locale,
                  )}
                </strong>
              </div>
              <div>
                <span>Period activity</span>
                <strong>
                  {formatMinorMoney(
                    statement.periodDebitMinor - statement.periodCreditMinor,
                    data.defaultCurrency,
                    data.locale,
                  )}
                </strong>
              </div>
              <div>
                <span>Closing balance</span>
                <strong>
                  {formatMinorMoney(
                    statement.closingBalanceMinor,
                    data.defaultCurrency,
                    data.locale,
                  )}
                </strong>
              </div>
            </div>
            {statement.entries.length ? (
              <StatementEntryRows entries={statement.entries} data={data} />
            ) : (
              <EmptyReport
                title="No statement activity"
                detail="The opening and closing balances are unchanged for this period."
              />
            )}
          </>
        ) : (
          <EmptyReport
            title="Choose a client"
            detail="Use the client filter above to build a statement and enable CSV download."
          />
        )}
      </section>
    </section>
  );
}
