import { ArrowDownToLine, ArrowUpRight, CalendarRange, Filter, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { getDateTimeFormatter, getNumberFormatter } from "@/lib/intl-formatters";
import { formatMinorMoney } from "@/modules/finance/calculations";
import { getMetricDefinition } from "@/modules/reports/metric-definitions";
import {
  reportComparisonLabels,
  reportComparisons,
  reportQueryString,
  reportSectionLabels,
  type ReportCountRow,
  type ReportMetric,
  type ReportsWorkspaceData,
} from "@/modules/reports/reports";

type ReportFormat = Pick<ReportsWorkspaceData, "locale" | "currency">;

function hasWidget(data: ReportsWorkspaceData, key: string): boolean {
  return data.activeWidgetKeys.includes(key);
}

function money(value: number, data: ReportFormat): string {
  return formatMinorMoney(value, data.currency, data.locale);
}

function number(value: number, data: ReportFormat): string {
  return getNumberFormatter(data.locale, { maximumFractionDigits: 1 }).format(value);
}

function metricValue(metric: ReportMetric, data: ReportsWorkspaceData): string {
  if (metric.unit === "minor") return money(metric.value, data);
  if (metric.unit === "bps") return `${number(metric.value / 100, data)}%`;
  if (metric.unit === "minutes") return `${number(metric.value / 60, data)} h`;
  if (metric.unit === "days") return `${number(metric.value, data)} days`;
  return number(metric.value, data);
}

function MetricDefinitionDisclosure({ definitionKey }: { definitionKey?: string | null }) {
  const definition = getMetricDefinition(definitionKey);
  if (!definition) return null;
  return (
    <details className="reports-metric-definition">
      <summary>Definition</summary>
      <div className="reports-metric-definition__body">
        <p>{definition.meaning}</p>
        <dl>
          <div>
            <dt>Formula</dt>
            <dd>{definition.formula}</dd>
          </div>
          <div>
            <dt>Sources</dt>
            <dd>{definition.sourceEntities.join(", ")}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{definition.currencyRule}</dd>
          </div>
          {definition.caveats.length ? (
            <div>
              <dt>Caveats</dt>
              <dd>{definition.caveats.join(" ")}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </details>
  );
}

function MetricStrip({ data }: { data: ReportsWorkspaceData }) {
  return (
    <section className="reports-metric-strip" aria-label="Report summary">
      {data.summary.map((metric) => {
        const delta = metric.comparisonValue == null ? null : metric.value - metric.comparisonValue;
        return (
          <article className="reports-metric" key={metric.id}>
            <div className="reports-metric__value">
              <span>{metric.label}</span>
              <strong>{metricValue(metric, data)}</strong>
              <small>
                {delta == null
                  ? "Current authorized report scope"
                  : `${delta >= 0 ? "+" : ""}${metric.unit === "minor" ? money(delta, data) : number(delta, data)} vs comparison`}
              </small>
            </div>
            <div className="reports-metric__actions">
              <Link href={metric.href}>Open source</Link>
              <MetricDefinitionDisclosure definitionKey={metric.definitionKey} />
            </div>
          </article>
        );
      })}
    </section>
  );
}

function Breakdown({
  title,
  rows,
  locale,
  currency,
  value = "count",
}: {
  title: string;
  rows: ReportCountRow[];
  locale: string;
  currency: string;
  value?: "count" | "amount" | "days" | "rate";
}) {
  const format = { locale, currency };
  const values = rows.map((row) => {
    if (value === "amount") return row.amountMinor ?? 0;
    if (value === "days") return row.averageDays ?? 0;
    if (value === "rate") return row.rateBps ?? 0;
    return row.count;
  });
  const max = Math.max(1, ...values.map(Math.abs));
  return (
    <section className="reports-breakdown">
      <header>
        <h3>{title}</h3>
        <span>{rows.length} groups</span>
      </header>
      {rows.length === 0 ? (
        <p className="empty-state">No authorized data for this period.</p>
      ) : (
        <div className="reports-breakdown__rows">
          {rows.map((row, index) => {
            const raw = values[index] ?? 0;
            const label =
              value === "amount"
                ? money(raw, format)
                : value === "days"
                  ? `${number(raw, format)} days`
                  : value === "rate"
                    ? `${number(raw / 100, format)}%`
                    : number(raw, format);
            return (
              <div className="reports-breakdown__row" key={row.id}>
                <div>
                  <strong>{row.label}</strong>
                  {row.secondary ? <small>{row.secondary}</small> : null}
                </div>
                <div className="reports-breakdown__measure">
                  <span
                    className="reports-breakdown__bar"
                    style={
                      {
                        "--report-width": `${Math.max(2, Math.round((Math.abs(raw) / max) * 100))}%`,
                      } as React.CSSProperties
                    }
                  />
                  <b>{label}</b>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReportFilters({ data }: { data: ReportsWorkspaceData }) {
  return (
    <form className="reports-filters" method="get">
      <div className="reports-filters__heading">
        <Filter aria-hidden="true" size={17} />
        <strong>Report filters</strong>
        <span>Filters apply only where the source record supports them.</span>
      </div>
      <label>
        From
        <input type="date" name="from" defaultValue={data.filters.from} />
      </label>
      <label>
        To
        <input type="date" name="to" defaultValue={data.filters.to} />
      </label>
      <label>
        Comparison
        <select name="comparison" defaultValue={data.filters.comparison}>
          {reportComparisons.map((comparison) => (
            <option key={comparison} value={comparison}>
              {reportComparisonLabels[comparison]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Owner
        <select name="owner" defaultValue={data.filters.owner ?? ""}>
          <option value="">All visible owners</option>
          {data.options.owners.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Team
        <select name="team" defaultValue={data.filters.team ?? ""}>
          <option value="">All visible teams</option>
          {data.options.teams.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Department
        <select name="department" defaultValue={data.filters.department ?? ""}>
          <option value="">All visible departments</option>
          {data.options.departments.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project
        <select name="project" defaultValue={data.filters.project ?? ""}>
          <option value="">All visible projects</option>
          {data.options.projects.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Client
        <select name="client" defaultValue={data.filters.client ?? ""}>
          <option value="">All visible clients</option>
          {data.options.clients.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select name="status" defaultValue={data.filters.status ?? ""}>
          <option value="">All statuses</option>
          {data.options.statuses.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="section" value={data.filters.section} />
      <button className="button button--primary" type="submit">
        Apply filters
      </button>
      <Link className="button button--secondary" href="/reports">
        Reset
      </Link>
    </form>
  );
}

function SectionNav({ data }: { data: ReportsWorkspaceData }) {
  return (
    <nav className="reports-tabs" aria-label="Report sections">
      {data.capabilities.sections.map((section) => (
        <Link
          key={section}
          className={data.filters.section === section ? "is-active" : ""}
          href={`/reports?${reportQueryString(data.filters, { section })}`}
        >
          {reportSectionLabels[section]}
        </Link>
      ))}
    </nav>
  );
}

function CrmReport({ data }: { data: ReportsWorkspaceData }) {
  if (!data.crm) return null;
  return (
    <div className="reports-grid">
      {hasWidget(data, "crm.sources") ? (
        <Breakdown
          title="Leads by source"
          rows={data.crm.leadsBySource}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "crm.pipeline") ? (
        <Breakdown
          title="Pipeline value by stage"
          rows={data.crm.pipelineByStage}
          locale={data.locale}
          currency={data.currency}
          value="amount"
        />
      ) : null}
      {hasWidget(data, "crm.status") ? (
        <Breakdown
          title="Lead status"
          rows={data.crm.leadsByStatus}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "crm.owners") ? (
        <Breakdown
          title="Sales by owner"
          rows={data.crm.salesByOwner}
          locale={data.locale}
          currency={data.currency}
          value="amount"
        />
      ) : null}
      {hasWidget(data, "crm.stage_time") ? (
        <Breakdown
          title="Average time in stage"
          rows={data.crm.timeInStage}
          locale={data.locale}
          currency={data.currency}
          value="days"
        />
      ) : null}
      {hasWidget(data, "crm.lost_reasons") ? (
        <Breakdown
          title="Lost reasons"
          rows={data.crm.lostReasons}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
    </div>
  );
}

function ProjectsReport({ data }: { data: ReportsWorkspaceData }) {
  if (!data.projects) return null;
  return (
    <div className="reports-stack">
      {hasWidget(data, "projects.performance") ? (
        <section className="reports-table-panel">
          <header>
            <div>
              <h3>Project performance</h3>
              <p>Progress, overdue work, time, and financial contribution.</p>
            </div>
          </header>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Overdue</th>
                  <th>Hours</th>
                  <th>Gross profit</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.projects.projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <strong className="table-primary">{project.code}</strong>
                      <span className="table-secondary">{project.name}</span>
                    </td>
                    <td>{project.status}</td>
                    <td>{project.progress}%</td>
                    <td>{project.overdueTasks}</td>
                    <td>
                      {number(project.actualMinutes / 60, data)} /{" "}
                      {number(project.estimatedMinutes / 60, data)}
                    </td>
                    <td>{money(project.grossProfitMinor, data)}</td>
                    <td>
                      <Link
                        href={`/projects?project=${project.id}`}
                        aria-label={`Open ${project.name}`}
                      >
                        <ArrowUpRight aria-hidden="true" size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {hasWidget(data, "projects.workload") ? (
        <section className="reports-table-panel">
          <header>
            <div>
              <h3>Team workload</h3>
              <p>Open work, overdue work, estimated effort, actual time, and capacity use.</p>
            </div>
          </header>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Department</th>
                  <th>Open tasks</th>
                  <th>Overdue</th>
                  <th>Estimated hours</th>
                  <th>Actual hours</th>
                  <th>Utilization</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.workload.map((row) => (
                  <tr key={row.membershipId}>
                    <td>
                      <strong className="table-primary">{row.name}</strong>
                    </td>
                    <td>{row.department ?? "Unassigned"}</td>
                    <td>{row.openTasks}</td>
                    <td>{row.overdueTasks}</td>
                    <td>{number(row.estimatedMinutes / 60, data)}</td>
                    <td>{number(row.actualMinutes / 60, data)}</td>
                    <td>{number(row.utilizationBps / 100, data)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ClientConcentrationReport({ data }: { data: ReportsWorkspaceData }) {
  const metrics = data.finance?.clientConcentration ?? [];
  const kindLabels = {
    revenue: "Revenue",
    receivables: "Receivables",
    pipeline: "Weighted pipeline",
  } as const;
  return (
    <section className="reports-breakdown reports-client-concentration">
      <header>
        <h3>Client concentration risk</h3>
        <span>{metrics.length} currency slices</span>
      </header>
      {metrics.length === 0 ? (
        <p className="empty-state">No authorized concentration data for this scope.</p>
      ) : (
        <div className="reports-client-concentration__rows">
          {metrics.map((metric) => (
            <article className="reports-client-concentration__metric" key={metric.id}>
              <div className="reports-client-concentration__heading">
                <div>
                  <strong>{kindLabels[metric.kind]}</strong>
                  <small>{metric.currency}</small>
                </div>
                <div>
                  <b>Largest {(metric.largestShareBps / 100).toFixed(1)}%</b>
                  <small>Top 3 {(metric.topThreeShareBps / 100).toFixed(1)}%</small>
                </div>
              </div>
              <ol>
                {metric.entries.map((entry) => (
                  <li key={entry.id}>
                    <Link href={entry.href}>{entry.label}</Link>
                    <span>{(entry.shareBps / 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ol>
              <div className="reports-client-concentration__actions">
                <Link href={metric.sourceHref}>Open all source records</Link>
                <MetricDefinitionDisclosure definitionKey={metric.definitionKey} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function FinanceReport({ data }: { data: ReportsWorkspaceData }) {
  if (!data.finance) return null;
  return (
    <div className="reports-grid">
      {hasWidget(data, "finance.revenue") ? (
        <Breakdown
          title="Revenue by month"
          rows={data.finance.revenueByMonth}
          locale={data.locale}
          currency={data.currency}
          value="amount"
        />
      ) : null}
      {hasWidget(data, "finance.balances") ? (
        <Breakdown
          title="Outstanding client balances"
          rows={data.finance.clientBalances}
          locale={data.locale}
          currency={data.currency}
          value="amount"
        />
      ) : null}
      {hasWidget(data, "finance.concentration") ? <ClientConcentrationReport data={data} /> : null}
      {hasWidget(data, "finance.expenses") ? (
        <Breakdown
          title="Expenses by category"
          rows={data.finance.expenseBreakdown}
          locale={data.locale}
          currency={data.currency}
          value="amount"
        />
      ) : null}
      {hasWidget(data, "finance.summary") ? (
        <section className="reports-breakdown reports-finance-summary">
          <header>
            <h3>Finance summary</h3>
          </header>
          <dl>
            <div>
              <dt>Revenue</dt>
              <dd>{money(data.finance.revenueMinor, data)}</dd>
            </div>
            <div>
              <dt>Expenses</dt>
              <dd>{money(data.finance.expensesMinor, data)}</dd>
            </div>
            <div>
              <dt>Gross profit</dt>
              <dd>{money(data.finance.grossProfitMinor, data)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{money(data.finance.taxMinor, data)}</dd>
            </div>
            <div>
              <dt>Outstanding</dt>
              <dd>{money(data.finance.outstandingMinor, data)}</dd>
            </div>
            <div>
              <dt>Overdue</dt>
              <dd>{money(data.finance.overdueMinor, data)}</dd>
            </div>
            <div>
              <dt>Collection rate</dt>
              <dd>{number(data.finance.collectionRateBps / 100, data)}%</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function HrReport({ data }: { data: ReportsWorkspaceData }) {
  if (!data.hr) return null;
  return (
    <div className="reports-grid">
      {hasWidget(data, "hr.departments") ? (
        <Breakdown
          title="Headcount by department"
          rows={data.hr.departments}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "hr.attendance") ? (
        <Breakdown
          title="Attendance"
          rows={data.hr.attendance}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "hr.leave") ? (
        <Breakdown
          title="Approved leave"
          rows={data.hr.leave}
          locale={data.locale}
          currency={data.currency}
          value="days"
        />
      ) : null}
      {hasWidget(data, "hr.probation") ? (
        <Breakdown
          title="Probation reviews"
          rows={data.hr.probationReviews}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "hr.documents") ? (
        <Breakdown
          title="Expiring employee documents"
          rows={data.hr.expiringDocuments}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "hr.assets") ? (
        <Breakdown
          title="Asset assignments"
          rows={data.hr.assetAssignments}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
    </div>
  );
}

function SupportReport({ data }: { data: ReportsWorkspaceData }) {
  if (!data.support) return null;
  return (
    <div className="reports-grid">
      {hasWidget(data, "support.categories") ? (
        <Breakdown
          title="Tickets by category"
          rows={data.support.byCategory}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "support.clients") ? (
        <Breakdown
          title="Tickets by client"
          rows={data.support.byClient}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "support.workload") ? (
        <Breakdown
          title="Agent workload"
          rows={data.support.agentWorkload}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "support.summary") ? (
        <section className="reports-breakdown reports-finance-summary">
          <header>
            <h3>Service summary</h3>
          </header>
          <dl>
            <div>
              <dt>Open tickets</dt>
              <dd>{data.support.openTickets}</dd>
            </div>
            <div>
              <dt>SLA breaches</dt>
              <dd>{data.support.slaBreaches}</dd>
            </div>
            <div>
              <dt>Average resolution</dt>
              <dd>
                {data.support.averageResolutionHours == null
                  ? "No data"
                  : `${number(data.support.averageResolutionHours, data)} h`}
              </dd>
            </div>
            <div>
              <dt>Satisfaction</dt>
              <dd>
                {data.support.satisfaction.averageScore == null
                  ? "No responses"
                  : `${number(data.support.satisfaction.averageScore, data)} / 5`}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function LegalReport({ data }: { data: ReportsWorkspaceData }) {
  if (!data.legal) return null;
  return (
    <div className="reports-grid">
      {hasWidget(data, "legal.expiring") ? (
        <Breakdown
          title="Expiring contracts"
          rows={data.legal.expiringContracts}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "legal.signatures") ? (
        <Breakdown
          title="Pending signatures"
          rows={data.legal.pendingSignatures}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "legal.renewals") ? (
        <Breakdown
          title="Renewal obligations"
          rows={data.legal.renewalObligations}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "legal.restricted_access") ? (
        <Breakdown
          title="Restricted file access events"
          rows={data.legal.restrictedAccessEvents}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
      {hasWidget(data, "legal.licences") ? (
        <Breakdown
          title="Licence expirations"
          rows={data.legal.licenceExpirations}
          locale={data.locale}
          currency={data.currency}
        />
      ) : null}
    </div>
  );
}

function FounderPackReport({ data }: { data: ReportsWorkspaceData }) {
  if (!data.founderPack) return <p className="empty-state">No authorized founder report data.</p>;
  return (
    <div className="reports-founder-pack">
      {data.founderPack.blocks
        .filter((block) => hasWidget(data, block.id))
        .map((block) => (
          <section className="reports-breakdown" key={block.id}>
            <header>
              <h3>{block.title}</h3>
              <span>{block.rows.length} signals</span>
            </header>
            <div className="reports-founder-pack__rows">
              {block.rows.map((item) => (
                <div
                  className={`reports-founder-pack__row reports-founder-pack__row--${item.tone ?? "neutral"}`}
                  key={item.id}
                >
                  <div>
                    <strong>{item.label}</strong>
                    {getMetricDefinition(item.definitionKey) ? (
                      <small>{getMetricDefinition(item.definitionKey)?.meaning}</small>
                    ) : null}
                    {item.detail ? <small>{item.detail}</small> : null}
                  </div>
                  <div>
                    <b>{item.value}</b>
                    {item.href ? <Link href={item.href}>Open source</Link> : null}
                    <MetricDefinitionDisclosure definitionKey={item.definitionKey} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

function ActiveSection({ data }: { data: ReportsWorkspaceData }) {
  const section = data.capabilities.sections.includes(data.filters.section)
    ? data.filters.section
    : "overview";
  if (section === "crm") return <CrmReport data={data} />;
  if (section === "projects") return <ProjectsReport data={data} />;
  if (section === "finance") return <FinanceReport data={data} />;
  if (section === "hr") return <HrReport data={data} />;
  if (section === "support") return <SupportReport data={data} />;
  if (section === "legal") return <LegalReport data={data} />;
  if (section === "founder_daily" || section === "founder_weekly")
    return <FounderPackReport data={data} />;
  return (
    <div className="reports-overview">
      {hasWidget(data, "overview.summary") ? <MetricStrip data={data} /> : null}
      <div className="reports-grid">
        {data.crm && hasWidget(data, "overview.pipeline") ? (
          <Breakdown
            title="Pipeline value"
            rows={data.crm.pipelineByStage}
            locale={data.locale}
            currency={data.currency}
            value="amount"
          />
        ) : null}
        {data.finance && hasWidget(data, "overview.revenue") ? (
          <Breakdown
            title="Revenue trend"
            rows={data.finance.revenueByMonth}
            locale={data.locale}
            currency={data.currency}
            value="amount"
          />
        ) : null}
        {data.projects && hasWidget(data, "overview.workload") ? (
          <Breakdown
            title="Project workload"
            rows={data.projects.workload.map((row) => ({
              id: row.membershipId,
              label: row.name,
              count: row.openTasks,
              secondary: `${row.overdueTasks} overdue`,
            }))}
            locale={data.locale}
            currency={data.currency}
          />
        ) : null}
        {data.support && hasWidget(data, "overview.support") ? (
          <Breakdown
            title="Support by category"
            rows={data.support.byCategory}
            locale={data.locale}
            currency={data.currency}
          />
        ) : null}
      </div>
    </div>
  );
}

export function ReportsWorkspace({ data }: { data: ReportsWorkspaceData }) {
  const generated = getDateTimeFormatter(data.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(data.generatedAt));
  const exportQuery = reportQueryString(data.filters);
  const exportHref = data.savedViewId
    ? `/api/reports/export?view=${encodeURIComponent(data.savedViewId)}`
    : `/api/reports/export?${exportQuery}`;
  return (
    <div className="reports-workspace">
      <section className="reports-toolbar">
        <div>
          <CalendarRange aria-hidden="true" size={18} />
          <span>
            {data.filters.from} to {data.filters.to}
          </span>
          {data.comparisonPeriod ? (
            <small>
              Compared with {data.comparisonPeriod.from} to {data.comparisonPeriod.to}
            </small>
          ) : null}
        </div>
        <div>
          <span className="reports-generated">
            <ShieldCheck aria-hidden="true" size={15} />
            Generated {generated}
          </span>
          {data.capabilities.canExport ? (
            <a className="button button--secondary" href={exportHref}>
              <ArrowDownToLine aria-hidden="true" size={16} />
              Export CSV
            </a>
          ) : null}
        </div>
      </section>
      <ReportFilters data={data} />
      <SectionNav data={data} />
      <ActiveSection data={data} />
    </div>
  );
}
