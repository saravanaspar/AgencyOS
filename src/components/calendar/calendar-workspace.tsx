"use client";

import Link from "next/link";
import { useActionState, useMemo } from "react";
import { CalendarClock, ExternalLink, MapPin, Repeat2, Users } from "lucide-react";

import { CalendarActionMessage } from "@/components/calendar/calendar-action-message";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import {
  cancelCalendarEventAction,
  createCalendarEventAction,
} from "@/modules/calendar/actions/calendar";
import {
  calendarEventTypeLabels,
  calendarEventTypes,
  calendarRecurrenceFrequencies,
  calendarRecurrenceLabels,
  calendarScopeLabels,
  calendarScopes,
  calendarScopesAllowedForPermission,
  calendarViewLabels,
  calendarViews,
  calendarVisibilityLabels,
  calendarVisibilityOptions,
  customCalendarEventTypes,
} from "@/modules/calendar/calendar";
import type { CalendarActionState } from "@/modules/calendar/schemas/calendar";
import type {
  CalendarEventSummary,
  CalendarWorkspaceData,
} from "@/modules/calendar/server/calendar";

const initialState: CalendarActionState = { status: "idle", message: "" };
const dateFormatter = getDateTimeFormatter("en", { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFormatter = getDateTimeFormatter("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const timeFormatter = getDateTimeFormatter("en", { timeStyle: "short", timeZone: "UTC" });
const weekdayFormatter = getDateTimeFormatter("en", { weekday: "short", timeZone: "UTC" });

function utcDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(value: Date | string): string {
  return (typeof value === "string" ? new Date(value) : value).toISOString().slice(0, 10);
}

function formatEventTime(event: CalendarEventSummary): string {
  if (event.allDay) {
    const start = dateFormatter.format(new Date(event.startsAt));
    const end = new Date(event.endsAt);
    end.setUTCDate(end.getUTCDate() - 1);
    const endText = dateFormatter.format(end);
    return start === endText ? start : `${start} – ${endText}`;
  }
  return `${dateTimeFormatter.format(new Date(event.startsAt))} – ${timeFormatter.format(new Date(event.endsAt))} UTC`;
}

function queryHref(data: CalendarWorkspaceData, changes: Record<string, string>): string {
  const query = new URLSearchParams({
    anchor: data.filters.anchor,
    view: data.filters.view,
    scope: data.filters.scope,
    type: data.filters.type,
    project: data.filters.project,
    ...changes,
  });
  return `/calendar?${query.toString()}`;
}

function shiftedAnchor(data: CalendarWorkspaceData, direction: -1 | 1): string {
  const anchor = utcDate(data.filters.anchor);
  if (data.filters.view === "month") anchor.setUTCMonth(anchor.getUTCMonth() + direction);
  else if (data.filters.view === "week") anchor.setUTCDate(anchor.getUTCDate() + direction * 7);
  else anchor.setUTCDate(anchor.getUTCDate() + direction);
  return dateKey(anchor);
}

function EventCard({ event }: { event: CalendarEventSummary }) {
  return (
    <article className={`calendar-event calendar-event--${event.eventType}`}>
      <div className="calendar-event__heading">
        <div>
          <span className="calendar-event__type">{event.eventTypeLabel}</span>
          <h3>{event.title}</h3>
        </div>
        {event.visibility === "private" ? <span className="status-chip">Private</span> : null}
      </div>
      <p className="calendar-event__time">
        <CalendarClock aria-hidden="true" size={15} /> {formatEventTime(event)}
      </p>
      {event.subtitle ? <p>{event.subtitle}</p> : null}
      <div className="calendar-event__meta">
        <span>{calendarScopeLabels[event.scope]}</span>
        <span>{event.derived ? `From ${event.source}` : "Agency event"}</span>
        {event.ownerName ? <span>Owner: {event.ownerName}</span> : null}
      </div>
      {event.location ? (
        <p className="calendar-event__detail">
          <MapPin aria-hidden="true" size={14} /> {event.location}
        </p>
      ) : null}
      {event.recurrenceLabel ? (
        <p className="calendar-event__detail">
          <Repeat2 aria-hidden="true" size={14} /> {event.recurrenceLabel}
        </p>
      ) : null}
      {event.attendees.length > 0 ? (
        <p className="calendar-event__detail">
          <Users aria-hidden="true" size={14} />
          {event.attendees.map((attendee) => attendee.name).join(", ")}
        </p>
      ) : null}
      <div className="calendar-event__actions">
        <Link className="text-link" href={event.relatedHref}>
          Open related record <ExternalLink aria-hidden="true" size={14} />
        </Link>
        {event.meetingUrl ? (
          <a className="text-link" href={event.meetingUrl} target="_blank" rel="noreferrer">
            Join meeting <ExternalLink aria-hidden="true" size={14} />
          </a>
        ) : null}
        {!event.derived && event.canManage ? <CancelEventForm eventId={event.sourceId} /> : null}
      </div>
    </article>
  );
}

function CancelEventForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(cancelCalendarEventAction, initialState);
  return (
    <form action={action} className="calendar-cancel-form">
      <input type="hidden" name="eventId" value={eventId} />
      <button type="submit" className="button-link button-link--danger" disabled={pending}>
        Cancel event
      </button>
      <CalendarActionMessage state={state} />
    </form>
  );
}

function EventList({ events, emptyText }: { events: CalendarEventSummary[]; emptyText: string }) {
  if (events.length === 0) return <p className="empty-state">{emptyText}</p>;
  return (
    <div className="calendar-agenda-list">
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}

function CalendarGrid({ data }: { data: CalendarWorkspaceData }) {
  const days = useMemo(() => {
    const start = new Date(data.range.start);
    const count = data.filters.view === "month" ? 42 : data.filters.view === "week" ? 7 : 1;
    return Array.from({ length: count }, (_, index) => addDays(start, index));
  }, [data.filters.view, data.range.start]);
  const grouped = useMemo(() => {
    const result = new Map<string, CalendarEventSummary[]>();
    for (const event of data.events) {
      const start = utcDate(event.startsAt);
      const end = new Date(event.endsAt);
      const inclusiveEnd = event.allDay ? addDays(end, -1) : end;
      for (let day = start; day <= inclusiveEnd; day = addDays(day, 1)) {
        const key = dateKey(day);
        const items = result.get(key) ?? [];
        items.push(event);
        result.set(key, items);
      }
    }
    return result;
  }, [data.events]);

  if (data.filters.view === "agenda") {
    return <EventList events={data.events} emptyText="No events in this agenda range." />;
  }

  return (
    <div className={`calendar-grid calendar-grid--${data.filters.view}`}>
      {days.map((day) => {
        const key = dateKey(day);
        const events = grouped.get(key) ?? [];
        const outsideMonth =
          data.filters.view === "month" &&
          day.getUTCMonth() !== utcDate(data.filters.anchor).getUTCMonth();
        return (
          <section
            className={`calendar-day${outsideMonth ? " calendar-day--outside" : ""}`}
            key={key}
          >
            <header>
              <span>{weekdayFormatter.format(day)}</span>
              <strong>{day.getUTCDate()}</strong>
            </header>
            <div className="calendar-day__events">
              {events.length > 0 ? (
                events.map((event) => <EventCard key={`${key}:${event.id}`} event={event} />)
              ) : (
                <span className="calendar-day__empty">No events</span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CreateEventForm({ data }: { data: CalendarWorkspaceData }) {
  const [state, action, pending] = useActionState(createCalendarEventAction, initialState);
  const allowedScopes = calendarScopesAllowedForPermission(data.permissions.createScope);
  const ownerOptions =
    data.permissions.createScope === "own"
      ? data.members.filter((member) => member.id === data.currentMembershipId)
      : data.members;
  return (
    <details className="calendar-create-panel" open={data.events.length === 0}>
      <summary>Create agency event</summary>
      <form action={action} className="calendar-event-form">
        <label className="calendar-event-form__wide">
          Title
          <input name="title" required minLength={2} maxLength={180} />
        </label>
        <label>
          Event type
          <select name="eventType" defaultValue="meeting">
            {customCalendarEventTypes.map((type) => (
              <option key={type} value={type}>
                {calendarEventTypeLabels[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scope
          <select name="scope" defaultValue="personal">
            {allowedScopes.map((scope) => (
              <option key={scope} value={scope}>
                {calendarScopeLabels[scope]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Visibility
          <select name="visibility" defaultValue="public">
            {calendarVisibilityOptions.map((visibility) => (
              <option key={visibility} value={visibility}>
                {calendarVisibilityLabels[visibility]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <select name="ownerMembershipId" defaultValue={data.currentMembershipId}>
            {ownerOptions.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Team scope
          <select name="teamId" defaultValue="">
            <option value="">No team</option>
            {data.teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Department scope
          <select name="departmentId" defaultValue="">
            <option value="">No department</option>
            {data.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project scope
          <select name="projectId" defaultValue="">
            <option value="">No project</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starts
          <input
            type="datetime-local"
            name="startsAt"
            required
            defaultValue={`${data.filters.anchor}T09:00`}
          />
        </label>
        <label>
          Ends
          <input
            type="datetime-local"
            name="endsAt"
            required
            defaultValue={`${data.filters.anchor}T10:00`}
          />
        </label>
        <label className="checkbox-field">
          <input type="checkbox" name="allDay" /> All-day event
        </label>
        <label>
          Timezone
          <input name="timezone" defaultValue="UTC" required maxLength={80} />
        </label>
        <label>
          Repeats
          <select name="recurrenceFrequency" defaultValue="none">
            {calendarRecurrenceFrequencies.map((frequency) => (
              <option key={frequency} value={frequency}>
                {calendarRecurrenceLabels[frequency]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Repeat interval
          <input type="number" name="recurrenceInterval" min={1} max={52} defaultValue={1} />
        </label>
        <label>
          Repeat until
          <input type="date" name="recurrenceUntil" />
        </label>
        <label>
          Location
          <input name="location" maxLength={300} />
        </label>
        <label className="calendar-event-form__wide">
          Meeting link
          <input
            type="url"
            name="meetingUrl"
            placeholder="https://meet.example.com/..."
            maxLength={1000}
          />
        </label>
        <label className="calendar-event-form__wide">
          Attendees
          <select
            name="attendeeMembershipIds"
            multiple
            size={Math.min(6, Math.max(3, data.members.length))}
          >
            {data.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <small>Use Ctrl/Cmd to select multiple attendees.</small>
        </label>
        <label className="calendar-event-form__wide">
          Description
          <textarea name="description" rows={3} maxLength={4000} />
        </label>
        <div className="calendar-event-form__wide calendar-event-form__actions">
          <button className="button" type="submit" disabled={pending}>
            Create event
          </button>
          <CalendarActionMessage state={state} />
        </div>
      </form>
    </details>
  );
}

export function CalendarWorkspace({ data }: { data: CalendarWorkspaceData }) {
  const today = data.today;
  return (
    <div className="calendar-workspace">
      <section className="calendar-toolbar" aria-label="Calendar controls">
        <div className="calendar-toolbar__navigation">
          <Link
            className="button button--secondary"
            href={queryHref(data, { anchor: shiftedAnchor(data, -1) })}
          >
            Previous
          </Link>
          <div>
            <strong>{data.range.label}</strong>
            <span>{data.events.length} visible events</span>
          </div>
          <Link
            className="button button--secondary"
            href={queryHref(data, { anchor: shiftedAnchor(data, 1) })}
          >
            Next
          </Link>
          <Link className="button button--secondary" href={queryHref(data, { anchor: today })}>
            Today
          </Link>
        </div>
        <nav className="calendar-view-tabs" aria-label="Calendar view">
          {calendarViews.map((view) => (
            <Link
              className={view === data.filters.view ? "is-active" : ""}
              href={queryHref(data, { view })}
              key={view}
            >
              {calendarViewLabels[view]}
            </Link>
          ))}
        </nav>
      </section>

      <form method="get" className="calendar-filters">
        <input type="hidden" name="anchor" value={data.filters.anchor} />
        <input type="hidden" name="view" value={data.filters.view} />
        <label>
          Scope
          <select name="scope" defaultValue={data.filters.scope}>
            <option value="all">All permitted scopes</option>
            {calendarScopes.map((scope) => (
              <option key={scope} value={scope}>
                {calendarScopeLabels[scope]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Event type
          <select name="type" defaultValue={data.filters.type}>
            <option value="all">All event types</option>
            {calendarEventTypes.map((type) => (
              <option key={type} value={type}>
                {calendarEventTypeLabels[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select name="project" defaultValue={data.filters.project}>
            <option value="all">All projects</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Apply filters
        </button>
      </form>

      <section className="calendar-summary" aria-label="Event summary">
        {Object.entries(data.counts).map(([type, count]) => (
          <span key={type}>
            <strong>{count}</strong>
            {calendarEventTypeLabels[type as keyof typeof calendarEventTypeLabels] ?? type}
          </span>
        ))}
      </section>

      {data.permissions.canCreate ? <CreateEventForm data={data} /> : null}
      <CalendarGrid data={data} />
    </div>
  );
}
