import {
  ArrowUpRight,
  BellRing,
  BriefcaseBusiness,
  CalendarClock,
  ChartNoAxesCombined,
  CircleAlert,
  Clock3,
  IndianRupee,
  ListChecks,
  ShieldAlert,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import { getDateTimeFormatter, getNumberFormatter } from "@/lib/intl-formatters";
import { formatMinorMoney } from "@/modules/finance/calculations";
import { generateFounderWeeklyReviewAction } from "@/modules/reports/actions/founder-packs";
import type {
  DashboardMetric,
  DashboardSection,
  DashboardWorkspaceData,
} from "@/modules/dashboard/dashboard";

const metricIcons = {
  revenue: IndianRupee,
  "revenue-year": IndianRupee,
  outstanding: IndianRupee,
  overdue: CircleAlert,
  "active-projects": BriefcaseBusiness,
  "at-risk-projects": ShieldAlert,
  "overdue-tasks": ListChecks,
  "employee-utilization": UsersRound,
  "pending-approvals": ListChecks,
  "pending-leave": CalendarClock,
  "open-support": BellRing,
  "expiring-contracts": CalendarClock,
  "asset-returns": Clock3,
  "vendor-bills": IndianRupee,
  "my-tasks": ListChecks,
  "my-projects": BriefcaseBusiness,
  "leave-balance": CalendarClock,
  "assigned-assets": BriefcaseBusiness,
  notifications: BellRing,
  "time-week": Clock3,
  "team-overdue": UsersRound,
  "unsubmitted-time": Clock3,
} as const;

function formatMetric(metric: DashboardMetric, data: DashboardWorkspaceData): string {
  const formatter = getNumberFormatter(data.locale, { maximumFractionDigits: 1 });
  if (metric.unit === "minor") {
    return formatMinorMoney(metric.value, data.currency, data.locale);
  }
  if (metric.unit === "bps") return `${formatter.format(metric.value / 100)}%`;
  if (metric.unit === "minutes") return `${formatter.format(metric.value / 60)} h`;
  if (metric.unit === "days") return `${formatter.format(metric.value)} days`;
  return formatter.format(metric.value);
}

function MetricStrip({ data }: { data: DashboardWorkspaceData }) {
  return (
    <section className="dashboard-live-metrics" aria-label="Dashboard summary">
      {data.metrics.map((metric) => {
        const Icon = metricIcons[metric.id as keyof typeof metricIcons] ?? ChartNoAxesCombined;
        return (
          <Link
            href={metric.href}
            className={`dashboard-live-metric dashboard-live-metric--${metric.tone ?? "neutral"}`}
            key={metric.id}
          >
            <span className="dashboard-live-metric__icon">
              <Icon aria-hidden="true" size={18} />
            </span>
            <span>
              <small>{metric.label}</small>
              <strong>{formatMetric(metric, data)}</strong>
              <em>{metric.detail}</em>
            </span>
          </Link>
        );
      })}
    </section>
  );
}

function Section({ section, data }: { section: DashboardSection; data: DashboardWorkspaceData }) {
  const dateTime = getDateTimeFormatter(data.locale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <section className="panel dashboard-live-section">
      <header className="panel__header">
        <div>
          <h2>{section.title}</h2>
          <p>{section.description}</p>
        </div>
        <Link className="text-link" href={section.href}>
          Open module <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
      </header>
      {section.items.length === 0 ? (
        <p className="empty-state">No authorized items need attention.</p>
      ) : (
        <div className="dashboard-live-list">
          {section.items.map((item) => (
            <Link className="dashboard-live-item" href={item.href} key={item.id}>
              <span
                className={`dashboard-live-item__signal dashboard-live-item__signal--${item.tone ?? "neutral"}`}
              />
              <span className="dashboard-live-item__copy">
                <strong>{item.title}</strong>
                <small>{item.meta}</small>
              </span>
              <span className="dashboard-live-item__aside">
                {item.dueAt
                  ? dateTime.format(new Date(item.dueAt))
                  : (item.status?.replaceAll("_", " ") ?? "Open")}
                <ArrowUpRight aria-hidden="true" size={15} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function FounderAttentionQueue({ data }: { data: DashboardWorkspaceData }) {
  if (data.mode !== "owner") return null;
  const buckets = [
    ["critical", "Critical"],
    ["today", "Today"],
    ["this_week", "This week"],
  ] as const;
  return (
    <section className="founder-attention-queue" aria-labelledby="founder-attention-title">
      <header>
        <div>
          <span>Founder attention</span>
          <h2 id="founder-attention-title">What needs intervention</h2>
        </div>
        <div className="founder-attention-actions">
          <small>
            {data.attention.length} active signal{data.attention.length === 1 ? "" : "s"}
          </small>
          <Link className="button button--secondary" href="/reports?section=founder_daily">
            Daily brief
          </Link>
          <form action={generateFounderWeeklyReviewAction}>
            <button className="button button--secondary" type="submit">
              Generate weekly founder report
            </button>
          </form>
        </div>
      </header>
      {data.attention.length ? (
        <div className="founder-attention-groups">
          {buckets.map(([bucket, label]) => {
            const items = data.attention.filter((item) => item.bucket === bucket);
            if (!items.length) return null;
            return (
              <section
                key={bucket}
                className={`founder-attention-group founder-attention-group--${bucket}`}
              >
                <h3>
                  {label}
                  <span>{items.length}</span>
                </h3>
                <div>
                  {items.map((item) => (
                    <Link href={item.href} key={item.id} className="founder-attention-item">
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.reason}</small>
                        <small>{item.meta}</small>
                      </span>
                      {item.amountMinor != null && item.currency ? (
                        <b>{formatMinorMoney(item.amountMinor, item.currency, data.locale)}</b>
                      ) : null}
                      <ArrowUpRight aria-hidden="true" size={15} />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <p>Nothing currently requires founder intervention.</p>
      )}
    </section>
  );
}

export function RoleDashboard({ data }: { data: DashboardWorkspaceData }) {
  const today = getDateTimeFormatter(data.locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const modeTitle =
    data.mode === "owner"
      ? "Agency operations"
      : data.mode === "manager"
        ? "Team operations"
        : "My work";
  const modeDescription =
    data.mode === "owner"
      ? "Revenue, delivery, people, risk, approvals, and obligations that need intervention."
      : data.mode === "manager"
        ? "Workload, overdue delivery, approvals, leave, and activity for the people you manage."
        : "Assigned work, meetings, requests, assets, documents, notifications, and submitted time.";
  return (
    <div className="dashboard-page dashboard-page--live">
      <section className="page-heading">
        <div>
          <p className="page-heading__date">{today}</p>
          <h1>{modeTitle}</h1>
          <p>
            Welcome, {data.greetingName}. {modeDescription}
          </p>
        </div>
        <div className="dashboard-live-heading-meta">
          <span>Live data</span>
          <small>
            Updated{" "}
            {getDateTimeFormatter(data.locale, { timeStyle: "short" }).format(
              new Date(data.generatedAt),
            )}
          </small>
        </div>
      </section>
      <FounderAttentionQueue data={data} />
      <MetricStrip data={data} />
      {data.comparison.revenueMinor !== null ? (
        <section className="dashboard-live-comparison" aria-label="Revenue comparison">
          <span>Revenue comparison</span>
          <strong>
            {formatMinorMoney(data.comparison.revenueMinor, data.currency, data.locale)}
          </strong>
          <small>
            {data.comparison.periodLabel}:{" "}
            {formatMinorMoney(
              data.comparison.previousRevenueMinor ?? 0,
              data.currency,
              data.locale,
            )}
          </small>
        </section>
      ) : null}
      <div className="dashboard-live-grid">
        {data.sections.map((section) => (
          <Section key={section.id} section={section} data={data} />
        ))}
      </div>
    </div>
  );
}
