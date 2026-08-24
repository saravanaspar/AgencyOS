import { describe, expect, it } from "vitest";

import {
  calendarEventTypeLabels,
  calendarEventTypes,
  calendarPermissionKeys,
  calendarScopes,
  calendarViews,
  isCalendarEventType,
  isCalendarScope,
  isCalendarView,
} from "@/modules/calendar/calendar";
import { calendarEventSchema, calendarFiltersSchema } from "@/modules/calendar/schemas/calendar";
import { globalSearchKinds, normalizeGlobalSearchQuery } from "@/modules/search/search";

const id = "11111111-1111-4111-8111-111111111111";

const event = {
  title: "Client kickoff",
  description: "Kickoff meeting for the retained engagement.",
  eventType: "meeting",
  scope: "project",
  visibility: "public",
  ownerMembershipId: id,
  teamId: null,
  departmentId: null,
  projectId: id,
  startsAt: "2026-07-20T09:00:00.000Z",
  endsAt: "2026-07-20T10:00:00.000Z",
  allDay: false,
  timezone: "UTC",
  recurrenceFrequency: "weekly",
  recurrenceInterval: 1,
  recurrenceUntil: "2026-08-31",
  location: "Conference room A",
  meetingUrl: "https://meet.example.com/kickoff",
  attendeeMembershipIds: [id],
} as const;

describe("unified calendar and global search", () => {
  it("defines the expected calendar permissions, views, scopes, and source projections", () => {
    expect(calendarPermissionKeys).toEqual({
      workspace: "calendar.workspace.view",
      view: "calendar.event.view",
      create: "calendar.event.create",
      manage: "calendar.event.manage",
    });
    expect(calendarViews).toEqual(["month", "week", "day", "agenda"]);
    expect(calendarScopes).toEqual(["personal", "team", "department", "project", "company"]);
    expect(calendarEventTypes).toContain("project_deadline");
    expect(calendarEventTypes).toContain("invoice_due");
    expect(calendarEventTypes).toContain("asset_return");
    expect(calendarEventTypes).toContain("purchase_order_delivery");
    expect(calendarEventTypeLabels.purchase_request_due).toBe("Purchase request due");
  });

  it("validates scoped, recurring, HTTPS calendar events", () => {
    expect(calendarEventSchema.safeParse(event).success).toBe(true);
    expect(calendarEventSchema.safeParse({ ...event, projectId: null }).success).toBe(false);
    expect(
      calendarEventSchema.safeParse({ ...event, meetingUrl: "http://unsafe.example" }).success,
    ).toBe(false);
    expect(
      calendarEventSchema.safeParse({
        ...event,
        endsAt: "2026-07-20T08:59:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      calendarEventSchema.safeParse({
        ...event,
        recurrenceFrequency: "none",
        recurrenceUntil: "2026-08-31",
      }).success,
    ).toBe(false);
  });

  it("normalizes filters and recognizes supported values", () => {
    const filters = calendarFiltersSchema.parse({
      anchor: "2026-07-18",
      view: "week",
      scope: "team",
      type: "invoice_due",
      project: id,
    });
    expect(filters).toEqual({
      anchor: "2026-07-18",
      view: "week",
      scope: "team",
      type: "invoice_due",
      project: id,
    });
    expect(isCalendarView("agenda")).toBe(true);
    expect(isCalendarView("timeline")).toBe(false);
    expect(isCalendarScope("company")).toBe(true);
    expect(isCalendarEventType("contract_renewal")).toBe(true);
  });

  it("keeps global search queries bounded and metadata kinds explicit", () => {
    expect(normalizeGlobalSearchQuery("  SUP-000001   customer  ")).toBe("SUP-000001 customer");
    expect(normalizeGlobalSearchQuery("x".repeat(160))).toHaveLength(120);
    expect(globalSearchKinds).toContain("ticket");
    expect(globalSearchKinds).toContain("document");
    expect(globalSearchKinds).toContain("purchase_request");
    expect(globalSearchKinds).toContain("purchase_order");
    expect(globalSearchKinds).toContain("calendar_event");
    expect(globalSearchKinds).not.toContain("salary_slip");
  });
});
