"use client";

import { Archive, CalendarClock, FileDown, Pause, Save, Settings2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { ReportsActionMessage } from "@/components/reports/reports-action-message";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import { reportWidgetCatalog } from "@/modules/reports/report-builder";
import type { ReportStudioData } from "@/modules/reports/report-studio";
import type { ReportsWorkspaceData } from "@/modules/reports/reports";
import {
  archiveReportViewAction,
  generateReportSnapshotAction,
  pauseReportScheduleAction,
  saveReportScheduleAction,
  saveReportViewAction,
  undoReportDeliveryAction,
} from "@/modules/reports/actions/reports";
import {
  disableReportDeliveryDestinationAction,
  saveReportDeliveryDestinationAction,
} from "@/modules/reports/actions/delivery-destinations";
import type { ReportActionState } from "@/modules/reports/schemas/reports";

const initialState: ReportActionState = { status: "idle", message: "" };

function HiddenFilters({ data }: { data: ReportsWorkspaceData }) {
  return (
    <>
      <input type="hidden" name="from" value={data.filters.from} />
      <input type="hidden" name="to" value={data.filters.to} />
      <input type="hidden" name="comparison" value={data.filters.comparison} />
      <input type="hidden" name="section" value={data.filters.section} />
      <input type="hidden" name="owner" value={data.filters.owner ?? ""} />
      <input type="hidden" name="team" value={data.filters.team ?? ""} />
      <input type="hidden" name="department" value={data.filters.department ?? ""} />
      <input type="hidden" name="project" value={data.filters.project ?? ""} />
      <input type="hidden" name="client" value={data.filters.client ?? ""} />
      <input type="hidden" name="status" value={data.filters.status ?? ""} />
    </>
  );
}

function SavedViewForm({
  studio,
  report,
}: {
  studio: ReportStudioData;
  report: ReportsWorkspaceData;
}) {
  const [state, action, pending] = useActionState(saveReportViewAction, initialState);
  const selected = studio.selectedView;
  const widgets = reportWidgetCatalog[report.filters.section];
  const activeWidgetKeys = new Set(report.activeWidgetKeys);
  return (
    <form action={action} className="report-studio__form">
      <HiddenFilters data={report} />
      <input type="hidden" name="viewId" value={selected?.id ?? ""} />
      <div className="report-studio__form-grid">
        <label>
          View name
          <input name="name" defaultValue={selected?.name ?? ""} maxLength={100} required />
        </label>
        <label>
          Description
          <input name="description" defaultValue={selected?.description ?? ""} maxLength={500} />
        </label>
      </div>
      <div className="report-studio__form-grid">
        <label>
          Reporting period
          <select name="periodMode" defaultValue={selected?.periodMode ?? "custom"}>
            <option value="custom">Current custom dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_week">This week</option>
            <option value="last_week">Last week</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="quarter_to_date">Quarter to date</option>
            <option value="last_quarter">Last quarter</option>
            <option value="year_to_date">Year to date</option>
            <option value="trailing_7_days">Trailing 7 days</option>
            <option value="trailing_30_days">Trailing 30 days</option>
            <option value="trailing_90_days">Trailing 90 days</option>
          </select>
        </label>
        <label>
          Visibility
          <select name="visibility" defaultValue={selected?.visibility ?? "private"}>
            <option value="private">Private</option>
            <option value="founder">Founder / executives</option>
            <option value="management">Management</option>
            <option value="department">Department</option>
            <option value="organization">Organization</option>
            <option value="named">Named people</option>
          </select>
        </label>
        <label>
          Visibility department
          <select
            name="visibilityDepartmentId"
            defaultValue={selected?.visibilityDepartmentId ?? ""}
          >
            <option value="">None</option>
            {studio.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="report-studio__widgets">
        <legend>Named viewers</legend>
        {studio.recipients.map((recipient) => (
          <label key={recipient.membershipId}>
            <input
              type="checkbox"
              name="namedRecipientIds"
              value={recipient.membershipId}
              defaultChecked={selected?.namedRecipientIds.includes(recipient.membershipId) ?? false}
            />
            <span>
              {recipient.displayName}
              {recipient.email ? ` · ${recipient.email}` : ""}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="report-studio__widgets">
        <legend>Included report blocks</legend>
        {widgets.map((widget) => (
          <label key={widget.key}>
            <input
              type="checkbox"
              name="widgetKeys"
              value={widget.key}
              defaultChecked={activeWidgetKeys.has(widget.key)}
            />
            <span>{widget.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="report-studio__actions">
        {selected && studio.capabilities.canEditSelected ? (
          <button
            type="submit"
            className="button button--primary"
            name="saveMode"
            value="update"
            disabled={pending}
          >
            <Save aria-hidden="true" size={16} />
            Update saved view
          </button>
        ) : null}
        <button
          type="submit"
          className="button button--secondary"
          name="saveMode"
          value="create"
          disabled={pending}
        >
          <Save aria-hidden="true" size={16} />
          Save as new view
        </button>
      </div>
      <ReportsActionMessage state={state} />
    </form>
  );
}

function ScheduleForm({ studio }: { studio: ReportStudioData }) {
  const [state, action, pending] = useActionState(saveReportScheduleAction, initialState);
  const [pauseState, pauseAction, pausePending] = useActionState(
    pauseReportScheduleAction,
    initialState,
  );
  const view = studio.selectedView;
  if (!view) return null;
  const schedule = studio.schedule;
  return (
    <div className="report-studio__schedule">
      <form action={action} className="report-studio__form">
        <input type="hidden" name="savedViewId" value={view.id} />
        <div className="report-studio__form-grid report-studio__form-grid--schedule">
          <label>
            Frequency
            <select name="cadence" defaultValue={schedule?.cadence ?? "weekly"}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>
            Delivery time
            <input
              type="time"
              name="localTime"
              defaultValue={schedule?.localTime ?? "08:00"}
              required
            />
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              defaultValue={schedule?.timezone ?? studio.organizationTimezone}
              maxLength={100}
              required
            />
          </label>
          <label>
            Weekly day
            <select name="weekday" defaultValue={schedule?.weekday ?? 1}>
              <option value="1">Monday</option>
              <option value="2">Tuesday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
              <option value="6">Saturday</option>
              <option value="0">Sunday</option>
            </select>
          </label>
          <label>
            Monthly day
            <input
              type="number"
              name="monthDay"
              min={1}
              max={28}
              defaultValue={schedule?.monthDay ?? 1}
            />
          </label>
          <label>
            Format
            <select name="format" defaultValue={schedule?.format ?? "pdf"}>
              <option value="pdf">PDF</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label>
            Audience
            <select name="audience" defaultValue={schedule?.audience ?? "owner"}>
              <option value="owner">Only me</option>
              <option value="named">Named people</option>
              <option value="view_access">Everyone with view access</option>
              <option value="section_access">Everyone with section access</option>
            </select>
          </label>
          <label>
            Undo window (seconds)
            <input
              name="graceSeconds"
              type="number"
              min={0}
              max={30}
              defaultValue={schedule?.graceSeconds ?? 5}
            />
          </label>
        </div>
        <fieldset className="report-studio__widgets">
          <legend>Delivery channels</legend>
          <label>
            <input
              type="checkbox"
              name="deliveryChannels"
              value="in_app"
              defaultChecked={schedule?.deliveryChannels.includes("in_app") ?? true}
            />
            <span>In-app notification</span>
          </label>
          <label>
            <input
              type="checkbox"
              name="deliveryChannels"
              value="email"
              defaultChecked={schedule?.deliveryChannels.includes("email") ?? true}
            />
            <span>Email with the report attached</span>
          </label>
          {(["slack", "telegram", "webhook"] as const).map((channel) => (
            <label key={channel}>
              <input
                type="checkbox"
                name="deliveryChannels"
                value={channel}
                defaultChecked={schedule?.deliveryChannels.includes(channel) ?? false}
              />
              <span>
                {channel.charAt(0).toUpperCase() + channel.slice(1)} via each recipient&apos;s
                configured destination
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="report-studio__widgets">
          <legend>Named delivery recipients</legend>
          {studio.recipients.map((recipient) => (
            <label key={recipient.membershipId}>
              <input
                type="checkbox"
                name="recipientIds"
                value={recipient.membershipId}
                defaultChecked={schedule?.recipientIds.includes(recipient.membershipId) ?? false}
              />
              <span>
                {recipient.displayName}
                {recipient.email ? ` · ${recipient.email}` : ""}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="report-studio__actions">
          <button type="submit" className="button button--primary" disabled={pending}>
            <CalendarClock aria-hidden="true" size={16} />
            {schedule ? "Update delivery" : "Schedule delivery"}
          </button>
        </div>
        {schedule ? (
          <p className="report-studio__hint">
            {schedule.status === "active" ? "Next run" : "Paused"}:{" "}
            {getDateTimeFormatter("en", { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(schedule.nextRunAt),
            )}
            {schedule.consecutiveFailureCount > 0
              ? `, ${schedule.consecutiveFailureCount} recent failure(s)`
              : ""}
          </p>
        ) : null}
        <ReportsActionMessage state={state} />
      </form>
      {schedule?.status === "active" ? (
        <form action={pauseAction}>
          <input type="hidden" name="savedViewId" value={view.id} />
          <button type="submit" className="button button--secondary" disabled={pausePending}>
            <Pause aria-hidden="true" size={16} />
            Pause delivery
          </button>
          <ReportsActionMessage state={pauseState} />
        </form>
      ) : null}
    </div>
  );
}

function DeliveryDestinationManager({ studio }: { studio: ReportStudioData }) {
  const [state, action, pending] = useActionState(
    saveReportDeliveryDestinationAction,
    initialState,
  );
  const [disableState, disableAction, disablePending] = useActionState(
    disableReportDeliveryDestinationAction,
    initialState,
  );
  if (!studio.capabilities.canManageDeliveryDestinations) return null;
  return (
    <section className="report-studio__schedule" aria-labelledby="report-destination-title">
      <div>
        <h3 id="report-destination-title">External delivery destinations</h3>
        <p>
          Destinations are private to your membership. Secrets are encrypted server-side and never
          returned to the browser.
        </p>
      </div>
      <form action={action} className="report-studio__form">
        <div className="report-studio__form-grid">
          <label>
            Name
            <input name="name" maxLength={100} required placeholder="Founder Slack" />
          </label>
          <label>
            Channel
            <select name="channel" defaultValue="slack">
              <option value="slack">Slack</option>
              <option value="telegram">Telegram</option>
              <option value="webhook">Webhook</option>
            </select>
          </label>
          <label>
            HTTPS URL
            <input
              name="url"
              type="url"
              placeholder="https://hooks.slack.com/services/... or webhook URL"
            />
          </label>
          <label>
            Telegram bot token
            <input name="botToken" type="password" autoComplete="off" />
          </label>
          <label>
            Telegram chat ID
            <input name="chatId" autoComplete="off" />
          </label>
          <label>
            Webhook bearer token (optional)
            <input name="bearerToken" type="password" autoComplete="off" />
          </label>
        </div>
        <div className="report-studio__actions">
          <button type="submit" className="button button--secondary" disabled={pending}>
            Save destination
          </button>
        </div>
        <ReportsActionMessage state={state} />
      </form>
      {studio.destinations.length ? (
        <div className="report-studio__history">
          {studio.destinations.map((destination) => (
            <form action={disableAction} key={destination.id}>
              <input type="hidden" name="destinationId" value={destination.id} />
              <strong>{destination.name}</strong>{" "}
              <small>
                {destination.channel} · {destination.status}
              </small>
              {destination.status === "active" ? (
                <button type="submit" className="text-link" disabled={disablePending}>
                  Disable
                </button>
              ) : null}
            </form>
          ))}
          <ReportsActionMessage state={disableState} />
        </div>
      ) : null}
    </section>
  );
}

function DeliveryHistory({ studio }: { studio: ReportStudioData }) {
  const [state, action, pending] = useActionState(undoReportDeliveryAction, initialState);
  if (studio.deliveryBatches.length === 0) return null;
  return (
    <section className="report-studio__snapshots" aria-label="Report delivery history">
      <h3>Delivery history</h3>
      <div className="report-studio__history">
        {studio.deliveryBatches.map((batch) => (
          <div key={batch.id}>
            <span>
              {batch.status.replaceAll("_", " ")} · {batch.recipientCount} recipient
              {batch.recipientCount === 1 ? "" : "s"}
            </span>
            <small>
              {batch.deliveredCount} delivered · {batch.failedCount} retrying/failed ·{" "}
              {batch.suppressedCount} suppressed
            </small>
            {batch.canUndo ? (
              <form action={action}>
                <input type="hidden" name="batchId" value={batch.id} />
                <button type="submit" className="button button--secondary" disabled={pending}>
                  <Undo2 aria-hidden="true" size={16} /> Undo queued delivery
                </button>
              </form>
            ) : null}
          </div>
        ))}
      </div>
      <ReportsActionMessage state={state} />
    </section>
  );
}

function SnapshotActions({ studio }: { studio: ReportStudioData }) {
  const [state, action, pending] = useActionState(generateReportSnapshotAction, initialState);
  const view = studio.selectedView;
  if (!view) return null;
  return (
    <div className="report-studio__snapshots">
      <form action={action} className="report-studio__actions">
        <input type="hidden" name="savedViewId" value={view.id} />
        <button
          type="submit"
          className="button button--secondary"
          name="format"
          value="pdf"
          disabled={pending}
        >
          <FileDown aria-hidden="true" size={16} />
          Generate PDF
        </button>
        <button
          type="submit"
          className="button button--secondary"
          name="format"
          value="csv"
          disabled={pending}
        >
          <FileDown aria-hidden="true" size={16} />
          Generate CSV
        </button>
      </form>
      <ReportsActionMessage state={state} />
      {studio.snapshots.length > 0 ? (
        <div className="report-studio__history">
          {studio.snapshots.map((snapshot) => (
            <a key={snapshot.id} href={`/api/reports/snapshots/${snapshot.id}`}>
              <span>
                {snapshot.format.toUpperCase()} · {snapshot.periodFrom} to {snapshot.periodTo}
              </span>
              <small>
                {snapshot.rowCount} rows ·{" "}
                {getDateTimeFormatter("en", { dateStyle: "medium", timeStyle: "short" }).format(
                  new Date(snapshot.generatedAt),
                )}
              </small>
            </a>
          ))}
        </div>
      ) : (
        <p className="report-studio__hint">No snapshots generated for this view.</p>
      )}
    </div>
  );
}

export function ReportStudio({
  studio,
  report,
}: {
  studio: ReportStudioData;
  report: ReportsWorkspaceData;
}) {
  const [archiveState, archiveAction, archivePending] = useActionState(
    archiveReportViewAction,
    initialState,
  );
  const selected = studio.selectedView;
  return (
    <details className="report-studio" open={Boolean(selected)}>
      <summary>
        <span>
          <Settings2 aria-hidden="true" size={18} /> Saved views and delivery
        </span>
        <small>{studio.savedViews.length} saved</small>
      </summary>
      <div className="report-studio__body">
        <nav className="report-studio__views" aria-label="Saved report views">
          <Link
            className={!selected ? "is-active" : ""}
            href={`/reports?section=${report.filters.section}`}
          >
            Current filters
          </Link>
          {studio.savedViews.map((view) => (
            <Link
              className={selected?.id === view.id ? "is-active" : ""}
              href={`/reports?view=${view.id}`}
              key={view.id}
            >
              <strong>{view.name}</strong>
              <small>{view.section}</small>
            </Link>
          ))}
        </nav>
        {studio.capabilities.canManageSavedViews ? (
          <SavedViewForm studio={studio} report={report} />
        ) : null}
        {selected && studio.capabilities.canCreateSnapshot ? (
          <SnapshotActions studio={studio} />
        ) : null}
        {studio.capabilities.canManageDeliveryDestinations ? (
          <DeliveryDestinationManager studio={studio} />
        ) : null}
        {selected && studio.capabilities.canSchedule ? <ScheduleForm studio={studio} /> : null}
        {selected && studio.capabilities.canSchedule ? <DeliveryHistory studio={studio} /> : null}
        {selected && studio.capabilities.canEditSelected ? (
          <form action={archiveAction} className="report-studio__archive">
            <input type="hidden" name="viewId" value={selected.id} />
            <button type="submit" className="button button--danger" disabled={archivePending}>
              <Archive aria-hidden="true" size={16} /> Archive saved view
            </button>
            <ReportsActionMessage state={archiveState} />
          </form>
        ) : null}
      </div>
    </details>
  );
}
