"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { calendarPermissionKeys } from "@/modules/calendar/calendar";
import {
  calendarEventSchema,
  cancelCalendarEventSchema,
  type CalendarActionState,
} from "@/modules/calendar/schemas/calendar";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

const success = (message: string): CalendarActionState => ({ status: "success", message });
const failure = (message: string, fieldErrors?: Record<string, string[]>): CalendarActionState => ({
  status: "error",
  message,
  fieldErrors,
});
const field = (formData: FormData, key: string) => formData.get(key);
const values = (formData: FormData, key: string) => formData.getAll(key).map(String);
const refresh = () => revalidatePath("/calendar");

function dateTimeValue(formData: FormData, key: string): string {
  const raw = String(field(formData, key) ?? "").trim();
  if (!raw) return raw;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

export async function createCalendarEventAction(
  _previous: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  const parsed = calendarEventSchema.safeParse({
    title: field(formData, "title"),
    description: field(formData, "description"),
    eventType: field(formData, "eventType"),
    scope: field(formData, "scope"),
    visibility: field(formData, "visibility"),
    ownerMembershipId: field(formData, "ownerMembershipId"),
    teamId: field(formData, "teamId"),
    departmentId: field(formData, "departmentId"),
    projectId: field(formData, "projectId"),
    startsAt: dateTimeValue(formData, "startsAt"),
    endsAt: dateTimeValue(formData, "endsAt"),
    allDay: field(formData, "allDay"),
    timezone: field(formData, "timezone") || "UTC",
    recurrenceFrequency: field(formData, "recurrenceFrequency") || "none",
    recurrenceInterval: field(formData, "recurrenceInterval") || "1",
    recurrenceUntil: field(formData, "recurrenceUntil"),
    location: field(formData, "location"),
    meetingUrl: field(formData, "meetingUrl"),
    attendeeMembershipIds: values(formData, "attendeeMembershipIds"),
  });
  if (!parsed.success) {
    return failure("Check the event fields.", parsed.error.flatten().fieldErrors);
  }

  const authorization = await authorizeCurrentUser([
    calendarPermissionKeys.workspace,
    calendarPermissionKeys.create,
  ]);
  if (!authorization.allowed) return failure("You cannot create calendar events.");
  const context = authorization.context;
  const input = parsed.data;
  const createScope = context.permissionScopes.get(calendarPermissionKeys.create) ?? "own";
  const ownerMembershipId = input.ownerMembershipId ?? context.membership.id;
  if (
    createScope === "own" &&
    (input.scope !== "personal" || ownerMembershipId !== context.membership.id)
  ) {
    return failure("Your calendar permission allows personal events only.");
  }

  try {
    const eventId = await getDatabaseClient().begin(async (sql) => {
      const organizationId = context.membership.organizationId;
      const memberIds = Array.from(new Set([ownerMembershipId, ...input.attendeeMembershipIds]));
      const validMembers = await sql<Array<{ id: string }>>`
        select id from public.memberships
        where organization_id = ${organizationId}::uuid and status = 'active'
          and id = any(${memberIds}::uuid[])
      `;
      if (validMembers.length !== memberIds.length) throw new Error("member-invalid");
      if (createScope !== "organization") {
        const ownerAllowed = await sql<Array<{ allowed: boolean }>>`
          select private.crm_scope_allows_membership(
            ${context.membership.id}::uuid, ${createScope},
            ${ownerMembershipId}::uuid, ${ownerMembershipId}::uuid
          ) as allowed
        `;
        if (!ownerAllowed[0]?.allowed) throw new Error("scope-invalid");
      }

      if (input.teamId) {
        const teams = await sql<Array<{ id: string }>>`
          select id from public.teams
          where id = ${input.teamId}::uuid and organization_id = ${organizationId}::uuid and status = 'active'
        `;
        if (!teams[0]) throw new Error("scope-invalid");
        if (createScope !== "organization") {
          const teamAccess = await sql<Array<{ allowed: boolean }>>`
            select exists (
              select 1 from public.team_members
              where team_id = ${input.teamId}::uuid
                and membership_id = ${context.membership.id}::uuid
            ) as allowed
          `;
          if (!teamAccess[0]?.allowed) throw new Error("scope-invalid");
        }
      }
      if (input.departmentId) {
        const departments = await sql<Array<{ id: string }>>`
          select id from public.departments
          where id = ${input.departmentId}::uuid and organization_id = ${organizationId}::uuid and status = 'active'
        `;
        if (!departments[0]) throw new Error("scope-invalid");
        if (createScope !== "organization") {
          const departmentAccess = await sql<Array<{ allowed: boolean }>>`
            select exists (
              select 1 from public.memberships
              where id = ${context.membership.id}::uuid
                and department_id = ${input.departmentId}::uuid
            ) as allowed
          `;
          if (!departmentAccess[0]?.allowed) throw new Error("scope-invalid");
        }
      }
      if (input.projectId) {
        const projects = await sql<Array<{ id: string }>>`
          select id from public.projects
          where id = ${input.projectId}::uuid and organization_id = ${organizationId}::uuid
            and private.project_is_visible(
              id, ${context.membership.id}::uuid,
              ${context.permissionScopes.get("projects.project.view") ?? "own"}
            )
        `;
        if (!projects[0]) throw new Error("scope-invalid");
      }

      const rows = await sql<Array<{ id: string }>>`
        insert into public.calendar_events (
          organization_id, title, description, event_type, scope, visibility,
          owner_membership_id, team_id, department_id, project_id,
          starts_at, ends_at, all_day, timezone,
          recurrence_frequency, recurrence_interval, recurrence_until,
          location, meeting_url, created_by_membership_id, updated_by_membership_id
        ) values (
          ${organizationId}::uuid, ${input.title}, ${input.description}, ${input.eventType},
          ${input.scope}, ${input.visibility}, ${ownerMembershipId}::uuid,
          ${input.scope === "team" ? input.teamId : null}::uuid,
          ${input.scope === "department" ? input.departmentId : null}::uuid,
          ${input.scope === "project" ? input.projectId : null}::uuid,
          ${input.startsAt}::timestamptz, ${input.endsAt}::timestamptz, ${input.allDay},
          ${input.timezone}, ${input.recurrenceFrequency}, ${input.recurrenceInterval},
          ${input.recurrenceUntil}::date, ${input.location}, ${input.meetingUrl},
          ${context.membership.id}::uuid, ${context.membership.id}::uuid
        ) returning id
      `;
      const createdId = rows[0]?.id;
      if (!createdId) throw new Error("create-failed");

      const attendees = Array.from(new Set(input.attendeeMembershipIds)).filter(
        (membershipId) => membershipId !== ownerMembershipId,
      );
      if (attendees.length > 0) {
        await sql`
          insert into public.calendar_event_attendees (
            event_id, membership_id, added_by_membership_id
          )
          select ${createdId}::uuid, attendee.membership_id, ${context.membership.id}::uuid
          from unnest(${attendees}::uuid[]) as attendee(membership_id)
          on conflict (event_id, membership_id) do nothing
        `;
      }
      await sql`
        insert into public.calendar_event_events (
          organization_id, calendar_event_id, event_type, actor_membership_id, details
        ) values (
          ${organizationId}::uuid, ${createdId}::uuid, 'created',
          ${context.membership.id}::uuid,
          ${sql.json(toJsonValue({ scope: input.scope, eventType: input.eventType, visibility: input.visibility }))}
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "calendar.event.created",
        entityType: "calendar_event",
        entityId: createdId,
        afterState: {
          title: input.title,
          eventType: input.eventType,
          scope: input.scope,
          visibility: input.visibility,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          attendeeCount: attendees.length,
        },
        changedFields: ["calendar_event"],
      });
      return createdId;
    });

    const recipients = Array.from(new Set(input.attendeeMembershipIds)).filter(
      (membershipId) => membershipId !== context.membership.id,
    );
    await Promise.allSettled(
      recipients.map((recipientMembershipId) =>
        enqueueNotification({
          organizationId: context.membership.organizationId,
          recipientMembershipId,
          category: "assignment",
          title: "Calendar invitation",
          message: `${input.title} starts ${new Date(input.startsAt).toLocaleString("en", { timeZone: "UTC" })} UTC.`,
          deepLink: `/calendar?event=${eventId}`,
          sourceModule: "calendar",
          sourceEntityType: "calendar_event",
          sourceEntityId: eventId,
          dedupeKey: `calendar-event:${eventId}:${recipientMembershipId}`,
          createdByMembershipId: context.membership.id,
        }),
      ),
    );
    refresh();
    return success("Calendar event created.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "member-invalid")
      return failure("An owner or attendee is not an active member.");
    if (message === "scope-invalid")
      return failure("The selected calendar scope is not available.");
    return failure("The calendar event could not be created.");
  }
}

export async function cancelCalendarEventAction(
  _previous: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  const parsed = cancelCalendarEventSchema.safeParse({ eventId: field(formData, "eventId") });
  if (!parsed.success) return failure("The event reference is invalid.");
  const authorization = await authorizeCurrentUser([
    calendarPermissionKeys.workspace,
    calendarPermissionKeys.view,
  ]);
  if (!authorization.allowed) return failure("You cannot manage this event.");
  const context = authorization.context;

  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<
        Array<{
          id: string;
          owner_membership_id: string;
          title: string;
          can_manage: boolean;
        }>
      >`
        select id, owner_membership_id, title,
          private.calendar_event_management_allowed(id, ${context.membership.id}::uuid) as can_manage
        from public.calendar_events
        where id = ${parsed.data.eventId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status = 'active'
          and private.calendar_event_membership_access_allowed(
            id, ${context.membership.id}::uuid, 'calendar.event.view'
          )
        for update
      `;
      const event = rows[0];
      if (!event) throw new Error("not-found");
      if (event.owner_membership_id !== context.membership.id && !event.can_manage) {
        throw new Error("forbidden");
      }
      await sql`
        update public.calendar_events set status = 'cancelled',
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${event.id}::uuid
      `;
      await sql`
        insert into public.calendar_event_events (
          organization_id, calendar_event_id, event_type, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${event.id}::uuid,
          'cancelled', ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "calendar.event.cancelled",
        entityType: "calendar_event",
        entityId: event.id,
        beforeState: { status: "active", title: event.title },
        afterState: { status: "cancelled", title: event.title },
        changedFields: ["status"],
      });
    });
    refresh();
    return success("Calendar event cancelled.");
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return failure("Only the owner or a calendar manager can cancel this event.");
    }
    return failure("The event could not be cancelled.");
  }
}
