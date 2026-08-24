import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  calendarEventTypeLabels,
  calendarPermissionKeys,
  calendarRecurrenceLabels,
  type CalendarEventType,
  type CalendarRecurrenceFrequency,
  type CalendarScope,
  type CalendarVisibility,
} from "@/modules/calendar/calendar";
import type { CalendarFilters } from "@/modules/calendar/schemas/calendar";
import { assetPermissionKeys } from "@/modules/assets/assets";
import { financePermissionKeys } from "@/modules/finance/finance";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { legalPermissionKeys } from "@/modules/legal/legal";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { projectPermissionKeys } from "@/modules/projects/projects";
import { vendorPermissionKeys } from "@/modules/vendors/vendors";

export interface CalendarAttendee {
  membershipId: string;
  name: string;
  responseStatus: "invited" | "accepted" | "tentative" | "declined";
}

export interface CalendarEventSummary {
  id: string;
  source: "calendar" | "projects" | "finance" | "legal" | "hr" | "assets" | "vendors";
  sourceId: string;
  title: string;
  subtitle: string | null;
  eventType: CalendarEventType;
  eventTypeLabel: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  scope: CalendarScope;
  visibility: CalendarVisibility;
  ownerMembershipId: string | null;
  ownerName: string | null;
  projectId: string | null;
  projectName: string | null;
  relatedHref: string;
  location: string | null;
  meetingUrl: string | null;
  attendees: CalendarAttendee[];
  recurrenceLabel: string | null;
  derived: boolean;
  canManage: boolean;
}

export interface CalendarWorkspaceData {
  events: CalendarEventSummary[];
  range: { start: string; end: string; label: string };
  filters: CalendarFilters;
  members: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  permissions: { canCreate: boolean; canManage: boolean; createScope: string | null };
  currentMembershipId: string;
  today: string;
  counts: Record<string, number>;
}

type CalendarResult =
  | { allowed: true; data: CalendarWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

interface CustomEventRow {
  id: string;
  title: string;
  description: string | null;
  event_type: CalendarEventType;
  scope: CalendarScope;
  visibility: CalendarVisibility;
  owner_membership_id: string;
  owner_name: string;
  project_id: string | null;
  project_name: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  recurrence_frequency: CalendarRecurrenceFrequency;
  recurrence_interval: number;
  recurrence_until: string | null;
  location: string | null;
  meeting_url: string | null;
  attendees: CalendarAttendee[];
  can_manage: boolean;
}

interface DerivedEventRow {
  id: string;
  title: string;
  subtitle: string | null;
  event_type: CalendarEventType;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  scope: CalendarScope;
  owner_membership_id: string | null;
  owner_name: string | null;
  project_id: string | null;
  project_name: string | null;
  related_href: string;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function resolveRange(filters: CalendarFilters): { start: Date; end: Date; label: string } {
  const anchor = utcDate(filters.anchor);
  if (filters.view === "day") {
    return { start: anchor, end: addDays(anchor, 1), label: filters.anchor };
  }
  if (filters.view === "week") {
    const start = addDays(anchor, -anchor.getUTCDay());
    return {
      start,
      end: addDays(start, 7),
      label: `${isoDate(start)} – ${isoDate(addDays(start, 6))}`,
    };
  }
  if (filters.view === "agenda") {
    return { start: addDays(anchor, -7), end: addDays(anchor, 120), label: "Upcoming agenda" };
  }
  const monthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const start = addDays(monthStart, -monthStart.getUTCDay());
  return {
    start,
    end: addDays(start, 42),
    label: monthStart.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

function incrementOccurrence(
  value: Date,
  frequency: CalendarRecurrenceFrequency,
  interval: number,
): Date {
  const next = new Date(value);
  if (frequency === "daily") next.setUTCDate(next.getUTCDate() + interval);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + interval * 7);
  if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + interval);
  return next;
}

function expandCustomEvents(
  rows: readonly CustomEventRow[],
  rangeStart: Date,
  rangeEnd: Date,
  currentMembershipId: string,
): CalendarEventSummary[] {
  const events: CalendarEventSummary[] = [];
  for (const row of rows) {
    const firstStart = new Date(row.starts_at);
    const duration = new Date(row.ends_at).getTime() - firstStart.getTime();
    let occurrenceStart = firstStart;
    let occurrence = 0;
    const recurrenceLimit = row.recurrence_until
      ? new Date(`${row.recurrence_until}T23:59:59.999Z`)
      : null;
    const recurring = row.recurrence_frequency !== "none";

    while (
      occurrenceStart.getTime() + duration < rangeStart.getTime() &&
      recurring &&
      occurrence < 5000
    ) {
      occurrenceStart = incrementOccurrence(
        occurrenceStart,
        row.recurrence_frequency,
        row.recurrence_interval,
      );
      occurrence += 1;
    }

    while (occurrenceStart < rangeEnd && occurrence < 5000) {
      if (recurrenceLimit && occurrenceStart > recurrenceLimit) break;
      const occurrenceEnd = new Date(occurrenceStart.getTime() + duration);
      if (occurrenceEnd >= rangeStart) {
        events.push({
          id: recurring ? `${row.id}:${occurrenceStart.toISOString()}` : row.id,
          source: "calendar",
          sourceId: row.id,
          title: row.title,
          subtitle: row.description,
          eventType: row.event_type,
          eventTypeLabel: calendarEventTypeLabels[row.event_type],
          startsAt: occurrenceStart.toISOString(),
          endsAt: occurrenceEnd.toISOString(),
          allDay: row.all_day,
          scope: row.scope,
          visibility: row.visibility,
          ownerMembershipId: row.owner_membership_id,
          ownerName: row.owner_name,
          projectId: row.project_id,
          projectName: row.project_name,
          relatedHref: `/calendar?event=${row.id}`,
          location: row.location,
          meetingUrl: row.meeting_url,
          attendees: row.attendees ?? [],
          recurrenceLabel: recurring
            ? `${calendarRecurrenceLabels[row.recurrence_frequency]}${row.recurrence_interval > 1 ? ` every ${row.recurrence_interval}` : ""}`
            : null,
          derived: false,
          canManage: row.can_manage || row.owner_membership_id === currentMembershipId,
        });
      }
      if (!recurring) break;
      occurrenceStart = incrementOccurrence(
        occurrenceStart,
        row.recurrence_frequency,
        row.recurrence_interval,
      );
      occurrence += 1;
    }
  }
  return events;
}

function mapDerived(
  source: CalendarEventSummary["source"],
  rows: readonly DerivedEventRow[],
): CalendarEventSummary[] {
  return rows.map((row) => ({
    id: `${source}:${row.event_type}:${row.id}`,
    source,
    sourceId: row.id,
    title: row.title,
    subtitle: row.subtitle,
    eventType: row.event_type,
    eventTypeLabel: calendarEventTypeLabels[row.event_type],
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    scope: row.scope,
    visibility: "public",
    ownerMembershipId: row.owner_membership_id,
    ownerName: row.owner_name,
    projectId: row.project_id,
    projectName: row.project_name,
    relatedHref: row.related_href,
    location: null,
    meetingUrl: null,
    attendees: [],
    recurrenceLabel: null,
    derived: true,
    canManage: false,
  }));
}

function withinFilters(
  event: CalendarEventSummary,
  filters: CalendarFilters,
  currentMembershipId: string,
): boolean {
  if (filters.type !== "all" && event.eventType !== filters.type) return false;
  if (filters.project !== "all" && event.projectId !== filters.project) return false;
  if (filters.scope === "all") return true;
  if (filters.scope === "personal") {
    return (
      event.ownerMembershipId === currentMembershipId ||
      event.attendees.some((attendee) => attendee.membershipId === currentMembershipId)
    );
  }
  return event.scope === filters.scope;
}

export async function getCalendarWorkspaceData(filters: CalendarFilters): Promise<CalendarResult> {
  const permissionContext = await getCurrentPermissionContext();
  if (!permissionContext.allowed) return permissionContext;
  const context = permissionContext.context;
  if (
    !context.permissions.has(calendarPermissionKeys.workspace) ||
    !context.permissions.has(calendarPermissionKeys.view)
  ) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const range = resolveRange(filters);
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();
  const startDate = isoDate(range.start);
  const endDate = isoDate(addDays(range.end, -1));
  const canCreate = context.permissions.has(calendarPermissionKeys.create);
  const canManage = context.permissions.has(calendarPermissionKeys.manage);
  const createScope = canCreate
    ? (context.permissionScopes.get(calendarPermissionKeys.create) ?? "own")
    : null;

  const workspaceRowsPromise = Promise.all([
    database<CustomEventRow[]>`
      select calendar_event.id, calendar_event.title, calendar_event.description,
        calendar_event.event_type, calendar_event.scope, calendar_event.visibility,
        calendar_event.owner_membership_id,
        private.membership_display_name(calendar_event.owner_membership_id) as owner_name,
        calendar_event.project_id, project.name as project_name,
        calendar_event.starts_at::text, calendar_event.ends_at::text, calendar_event.all_day,
        calendar_event.recurrence_frequency, calendar_event.recurrence_interval,
        calendar_event.recurrence_until::text, calendar_event.location, calendar_event.meeting_url,
        private.calendar_event_management_allowed(
          calendar_event.id, ${membershipId}::uuid
        ) as can_manage,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'membershipId', attendee.membership_id,
            'name', private.membership_display_name(attendee.membership_id),
            'responseStatus', attendee.response_status
          ) order by private.membership_display_name(attendee.membership_id))
          from public.calendar_event_attendees attendee
          where attendee.event_id = calendar_event.id
        ), '[]'::jsonb) as attendees
      from public.calendar_events calendar_event
      left join public.projects project on project.id = calendar_event.project_id
      where calendar_event.organization_id = ${organizationId}::uuid
        and calendar_event.status = 'active'
        and private.calendar_event_membership_access_allowed(
          calendar_event.id, ${membershipId}::uuid, 'calendar.event.view'
        )
        and calendar_event.starts_at < ${endIso}::timestamptz
        and (
          (calendar_event.recurrence_frequency = 'none' and calendar_event.ends_at >= ${startIso}::timestamptz)
          or (calendar_event.recurrence_frequency <> 'none'
            and (calendar_event.recurrence_until is null or calendar_event.recurrence_until >= ${startDate}::date))
        )
      order by calendar_event.starts_at, calendar_event.id
    `,
    database<Array<{ id: string; name: string }>>`
      select membership.id, private.membership_display_name(membership.id) as name
      from public.memberships membership
      where membership.organization_id = ${organizationId}::uuid and membership.status = 'active'
      order by name, membership.id
    `,
    database<Array<{ id: string; name: string }>>`
      select id, name from public.teams
      where organization_id = ${organizationId}::uuid and status = 'active'
      order by name
    `,
    database<Array<{ id: string; name: string }>>`
      select id, name from public.departments
      where organization_id = ${organizationId}::uuid and status = 'active'
      order by name
    `,
    database<Array<{ id: string; name: string }>>`
      select project.id, project.name
      from public.projects project
      where project.organization_id = ${organizationId}::uuid
        and project.status not in ('cancelled')
        and private.project_is_visible(
          project.id, ${membershipId}::uuid,
          ${context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own"}
        )
      order by project.name
    `,
  ]);

  const derivedQueries: Array<Promise<CalendarEventSummary[]>> = [];
  const queueDerived = (
    source: CalendarEventSummary["source"],
    query: PromiseLike<DerivedEventRow[]>,
  ) => {
    derivedQueries.push(Promise.resolve(query).then((rows) => mapDerived(source, rows)));
  };

  if (context.permissions.has(projectPermissionKeys.projectView)) {
    const projectScope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";
    queueDerived(
      "projects",
      database<DerivedEventRow[]>`
      select project.id, project.name || ' deadline' as title, project.code as subtitle,
        'project_deadline'::text as event_type,
        (project.due_date::timestamp at time zone 'UTC')::text as starts_at,
        ((project.due_date + 1)::timestamp at time zone 'UTC')::text as ends_at,
        true as all_day, 'project'::text as scope,
        project.owner_membership_id, private.membership_display_name(project.owner_membership_id) as owner_name,
        project.id as project_id, project.name as project_name,
        '/projects?project=' || project.id::text as related_href
      from public.projects project
      where project.organization_id = ${organizationId}::uuid
        and project.due_date between ${startDate}::date and ${endDate}::date
        and project.status not in ('completed', 'cancelled')
        and private.project_is_visible(project.id, ${membershipId}::uuid, ${projectScope})
      `,
    );

    if (context.permissions.has(projectPermissionKeys.taskView)) {
      queueDerived(
        "projects",
        database<DerivedEventRow[]>`
        select task.id, task.title, project.code || '-' || task.task_number::text as subtitle,
          'task_deadline'::text as event_type,
          (task.due_date::timestamp at time zone 'UTC')::text as starts_at,
          ((task.due_date + 1)::timestamp at time zone 'UTC')::text as ends_at,
          true as all_day, 'project'::text as scope,
          coalesce((select assignee.membership_id from public.project_task_assignees assignee
            where assignee.task_id = task.id order by assignee.created_at limit 1), task.created_by_membership_id) as owner_membership_id,
          private.membership_display_name(coalesce((select assignee.membership_id from public.project_task_assignees assignee
            where assignee.task_id = task.id order by assignee.created_at limit 1), task.created_by_membership_id)) as owner_name,
          project.id as project_id, project.name as project_name,
          '/projects?project=' || project.id::text as related_href
        from public.project_tasks task
        join public.projects project on project.id = task.project_id
        join public.project_task_statuses status on status.id = task.status_id
        where task.organization_id = ${organizationId}::uuid
          and task.due_date between ${startDate}::date and ${endDate}::date
          and not status.is_terminal and not status.is_cancelled
          and private.project_is_visible(project.id, ${membershipId}::uuid, ${projectScope})
        `,
      );
    }

    queueDerived(
      "projects",
      database<DerivedEventRow[]>`
      select milestone.id, milestone.name, project.code as subtitle,
        'milestone'::text as event_type,
        (milestone.due_date::timestamp at time zone 'UTC')::text as starts_at,
        ((milestone.due_date + 1)::timestamp at time zone 'UTC')::text as ends_at,
        true as all_day, 'project'::text as scope,
        project.owner_membership_id, private.membership_display_name(project.owner_membership_id) as owner_name,
        project.id as project_id, project.name as project_name,
        '/projects?project=' || project.id::text as related_href
      from public.project_milestones milestone
      join public.projects project on project.id = milestone.project_id
      where project.organization_id = ${organizationId}::uuid
        and milestone.due_date between ${startDate}::date and ${endDate}::date
        and milestone.status = 'open'
        and private.project_is_visible(project.id, ${membershipId}::uuid, ${projectScope})
      `,
    );
  }

  if (context.permissions.has(financePermissionKeys.invoiceView)) {
    queueDerived(
      "finance",
      database<DerivedEventRow[]>`
      select invoice.id,
        'Invoice ' || coalesce(invoice.invoice_number, invoice.draft_reference) || ' due' as title,
        coalesce(company.display_name, company.legal_name) as subtitle, 'invoice_due'::text as event_type,
        (invoice.due_date::timestamp at time zone 'UTC')::text as starts_at,
        ((invoice.due_date + 1)::timestamp at time zone 'UTC')::text as ends_at,
        true as all_day, case when invoice.project_id is null then 'company' else 'project' end as scope,
        invoice.created_by_membership_id as owner_membership_id,
        private.membership_display_name(invoice.created_by_membership_id) as owner_name,
        invoice.project_id, project.name as project_name,
        '/finance?invoice=' || invoice.id::text as related_href
      from public.finance_invoices invoice
      join public.crm_companies company on company.id = invoice.company_id
      left join public.projects project on project.id = invoice.project_id
      where invoice.organization_id = ${organizationId}::uuid
        and invoice.due_date between ${startDate}::date and ${endDate}::date
        and invoice.status not in ('draft', 'paid', 'void', 'credited')
      `,
    );
  }

  if (context.permissions.has(legalPermissionKeys.view)) {
    queueDerived(
      "legal",
      database<DerivedEventRow[]>`
      select contract.id, contract.title || ' renewal' as title,
        contract.internal_reference || ' · ' || contract.counterparty_name as subtitle,
        'contract_renewal'::text as event_type,
        (contract.renewal_date::timestamp at time zone 'UTC')::text as starts_at,
        ((contract.renewal_date + 1)::timestamp at time zone 'UTC')::text as ends_at,
        true as all_day, case when contract.department_id is null then 'company' else 'department' end as scope,
        contract.responsible_owner_membership_id as owner_membership_id,
        private.membership_display_name(contract.responsible_owner_membership_id) as owner_name,
        null::uuid as project_id, null::text as project_name,
        '/legal?contract=' || contract.id::text as related_href
      from public.legal_contracts contract
      where contract.organization_id = ${organizationId}::uuid
        and contract.renewal_date between ${startDate}::date and ${endDate}::date
        and contract.status not in ('terminated', 'expired', 'cancelled')
        and private.legal_contract_membership_access_allowed(
          contract.id, ${membershipId}::uuid, 'legal.contract.view'
        )
      `,
    );
  }

  if (context.permissions.has(hrPermissionKeys.leaveRequestView)) {
    const leaveScope = context.permissionScopes.get(hrPermissionKeys.leaveRequestView) ?? "own";
    queueDerived(
      "hr",
      database<DerivedEventRow[]>`
      select leave_request.id,
        private.membership_display_name(leave_request.membership_id) || ' · ' || leave_type.name as title,
        leave_request.requested_days::text || ' day(s)' as subtitle,
        'employee_leave'::text as event_type,
        (leave_request.start_date::timestamp at time zone 'UTC')::text as starts_at,
        ((leave_request.end_date + 1)::timestamp at time zone 'UTC')::text as ends_at,
        true as all_day, 'personal'::text as scope,
        leave_request.membership_id as owner_membership_id,
        private.membership_display_name(leave_request.membership_id) as owner_name,
        null::uuid as project_id, null::text as project_name,
        '/hr?leave=' || leave_request.id::text as related_href
      from public.hr_leave_requests leave_request
      join public.hr_leave_types leave_type on leave_type.id = leave_request.leave_type_id
      where leave_request.organization_id = ${organizationId}::uuid
        and leave_request.status = 'approved'
        and leave_request.start_date <= ${endDate}::date
        and leave_request.end_date >= ${startDate}::date
        and private.crm_scope_allows_membership(
          ${membershipId}::uuid, ${leaveScope},
          leave_request.membership_id, leave_request.membership_id
        )
      `,
    );
  }

  if (context.permissions.has(hrPermissionKeys.onboardingView)) {
    const employeeScope = context.permissionScopes.get(hrPermissionKeys.employeeView) ?? "own";
    queueDerived(
      "hr",
      database<DerivedEventRow[]>`
      select onboarding.id,
        private.membership_display_name(onboarding.membership_id) || ' probation review' as title,
        'Onboarding cycle ' || onboarding.cycle_number::text as subtitle,
        'probation_review'::text as event_type,
        (onboarding.probation_review_date::timestamp at time zone 'UTC')::text as starts_at,
        ((onboarding.probation_review_date + 1)::timestamp at time zone 'UTC')::text as ends_at,
        true as all_day, 'personal'::text as scope,
        onboarding.membership_id as owner_membership_id,
        private.membership_display_name(onboarding.membership_id) as owner_name,
        null::uuid as project_id, null::text as project_name,
        '/hr?onboarding=' || onboarding.id::text as related_href
      from public.hr_onboarding_plans onboarding
      where onboarding.organization_id = ${organizationId}::uuid
        and onboarding.probation_review_date between ${startDate}::date and ${endDate}::date
        and onboarding.status not in ('cancelled')
        and private.crm_scope_allows_membership(
          ${membershipId}::uuid, ${employeeScope}, onboarding.membership_id, onboarding.membership_id
        )
      `,
    );
  }

  if (context.permissions.has(assetPermissionKeys.view)) {
    queueDerived(
      "assets",
      database<DerivedEventRow[]>`
      select asset.id, asset.name || ' warranty expires' as title, asset.asset_tag as subtitle,
        'asset_warranty'::text as event_type,
        (asset.warranty_end_date::timestamp at time zone 'UTC')::text as starts_at,
        ((asset.warranty_end_date + 1)::timestamp at time zone 'UTC')::text as ends_at,
        true as all_day, 'company'::text as scope,
        asset.owner_membership_id, private.membership_display_name(asset.owner_membership_id) as owner_name,
        null::uuid as project_id, null::text as project_name,
        '/assets?q=' || asset.asset_tag as related_href
      from public.assets asset
      where asset.organization_id = ${organizationId}::uuid
        and asset.warranty_end_date between ${startDate}::date and ${endDate}::date
        and asset.status <> 'disposed'
        and private.asset_membership_access_allowed(asset.id, ${membershipId}::uuid, 'assets.asset.view')
      `,
    );

    queueDerived(
      "assets",
      database<DerivedEventRow[]>`
      select assignment.id, asset.name || ' expected return' as title, asset.asset_tag as subtitle,
        'asset_return'::text as event_type,
        assignment.expected_return_at::text as starts_at,
        (assignment.expected_return_at + interval '1 hour')::text as ends_at,
        false as all_day, 'personal'::text as scope,
        assignment.membership_id as owner_membership_id,
        private.membership_display_name(assignment.membership_id) as owner_name,
        null::uuid as project_id, null::text as project_name,
        '/assets?q=' || asset.asset_tag as related_href
      from public.asset_assignments assignment
      join public.assets asset on asset.id = assignment.asset_id
      where assignment.organization_id = ${organizationId}::uuid
        and assignment.returned_at is null
        and assignment.expected_return_at >= ${startIso}::timestamptz
        and assignment.expected_return_at < ${endIso}::timestamptz
        and private.asset_membership_access_allowed(asset.id, ${membershipId}::uuid, 'assets.asset.view')
      `,
    );
  }

  if (context.permissions.has(vendorPermissionKeys.requestView)) {
    queueDerived(
      "vendors",
      database<DerivedEventRow[]>`
      select request.id, request.title || ' required' as title,
        'PR-' || lpad(request.request_number::text, 6, '0') as subtitle,
        'purchase_request_due'::text as event_type,
        (request.required_by_date::timestamp at time zone 'UTC')::text as starts_at,
        ((request.required_by_date + 1)::timestamp at time zone 'UTC')::text as ends_at,
        true as all_day,
        case when request.project_id is not null then 'project'
          when request.department_id is not null then 'department' else 'company' end as scope,
        request.requester_membership_id as owner_membership_id,
        private.membership_display_name(request.requester_membership_id) as owner_name,
        request.project_id, project.name as project_name,
        '/vendors?q=PR-' || lpad(request.request_number::text, 6, '0') as related_href
      from public.procurement_purchase_requests request
      left join public.projects project on project.id = request.project_id
      where request.organization_id = ${organizationId}::uuid
        and request.required_by_date between ${startDate}::date and ${endDate}::date
        and request.status not in ('rejected', 'cancelled', 'received', 'closed')
        and private.purchase_request_membership_access_allowed(
          request.id, ${membershipId}::uuid, 'vendors.purchase_request.view'
        )
      `,
    );
  }

  if (context.permissions.has(vendorPermissionKeys.purchaseOrderView)) {
    queueDerived(
      "vendors",
      database<DerivedEventRow[]>`
      select purchase_order.id,
        'PO-' || lpad(purchase_order.purchase_order_number::text, 6, '0') || ' delivery' as title,
        vendor.display_name as subtitle, 'purchase_order_delivery'::text as event_type,
        (purchase_order.expected_delivery_date::timestamp at time zone 'UTC')::text as starts_at,
        ((purchase_order.expected_delivery_date + 1)::timestamp at time zone 'UTC')::text as ends_at,
        true as all_day, case when request.project_id is null then 'company' else 'project' end as scope,
        purchase_order.issued_by_membership_id as owner_membership_id,
        private.membership_display_name(purchase_order.issued_by_membership_id) as owner_name,
        request.project_id, project.name as project_name,
        '/vendors?q=PO-' || lpad(purchase_order.purchase_order_number::text, 6, '0') as related_href
      from public.procurement_purchase_orders purchase_order
      join public.procurement_purchase_requests request on request.id = purchase_order.purchase_request_id
      join public.vendors vendor on vendor.id = purchase_order.vendor_id
      left join public.projects project on project.id = request.project_id
      where purchase_order.organization_id = ${organizationId}::uuid
        and purchase_order.expected_delivery_date between ${startDate}::date and ${endDate}::date
        and purchase_order.status not in ('received', 'cancelled', 'closed')
        and private.purchase_order_membership_access_allowed(
          purchase_order.id, ${membershipId}::uuid, 'vendors.purchase_order.view'
        )
      `,
    );
  }

  const [[customRows, members, teams, departments, projects], derivedGroups] = await Promise.all([
    workspaceRowsPromise,
    Promise.all(derivedQueries),
  ]);
  const derived = derivedGroups.flat();

  const custom = expandCustomEvents(customRows, range.start, range.end, membershipId);
  const events = [...custom, ...derived]
    .filter((event) => withinFilters(event, filters, membershipId))
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) || left.title.localeCompare(right.title),
    );
  const counts = events.reduce<Record<string, number>>((result, event) => {
    result[event.eventType] = (result[event.eventType] ?? 0) + 1;
    return result;
  }, {});

  return {
    allowed: true,
    data: {
      events,
      range: { start: startIso, end: endIso, label: range.label },
      filters,
      members,
      teams,
      departments,
      projects,
      permissions: { canCreate, canManage, createScope },
      currentMembershipId: membershipId,
      today: isoDate(new Date()),
      counts,
    },
  };
}
