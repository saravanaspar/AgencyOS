import { describe, expect, it } from "vitest";

import {
  supportSlaState,
  supportTicketKey,
  supportTicketPriorities,
  supportTicketStatuses,
} from "@/modules/support/support";
import {
  supportTicketCreateSchema,
  supportTicketMessageSchema,
  supportTicketResolutionSchema,
} from "@/modules/support/schemas/support";

const ticket = {
  subject: "Campaign reporting is unavailable",
  description: "The client dashboard returns an error for the July report.",
  clientCompanyId: null,
  contactId: null,
  projectId: null,
  categoryId: null,
  priority: "high",
  dueAt: "2026-07-19T10:00",
} as const;

describe("support ticket foundation", () => {
  it("defines stable ticket keys, priorities, and lifecycle states", () => {
    expect(supportTicketKey(42)).toBe("SUP-000042");
    expect(supportTicketPriorities).toEqual(["low", "normal", "high", "urgent"]);
    expect(supportTicketStatuses).toContain("pending_customer");
    expect(supportTicketStatuses).toContain("closed");
  });

  it("validates ticket creation, message visibility type, and resolution requirements", () => {
    expect(supportTicketCreateSchema.safeParse(ticket).success).toBe(true);
    expect(supportTicketCreateSchema.safeParse({ ...ticket, subject: "x" }).success).toBe(false);
    expect(
      supportTicketMessageSchema.safeParse({
        ticketId: "11111111-1111-4111-8111-111111111111",
        messageType: "internal_note",
        body: "Escalate to engineering.",
      }).success,
    ).toBe(true);
    expect(
      supportTicketResolutionSchema.safeParse({
        ticketId: "11111111-1111-4111-8111-111111111111",
        action: "resolve",
        resolutionSummary: "Restored the reporting data source.",
      }).success,
    ).toBe(true);
  });

  it("classifies paused, breached, at-risk, healthy, and complete SLA states", () => {
    const base = {
      firstRespondedAt: null,
      firstResponseDueAt: "2026-07-18T10:00:00.000Z",
      resolutionDueAt: "2026-07-18T18:00:00.000Z",
      now: new Date("2026-07-18T12:00:00.000Z"),
    } as const;
    expect(supportSlaState({ ...base, status: "pending_customer" })).toBe("paused");
    expect(supportSlaState({ ...base, status: "open" })).toBe("first_response_breached");
    expect(
      supportSlaState({
        ...base,
        status: "open",
        firstRespondedAt: "2026-07-18T09:00:00.000Z",
        resolutionDueAt: "2026-07-18T11:00:00.000Z",
      }),
    ).toBe("resolution_breached");
    expect(
      supportSlaState({
        ...base,
        status: "open",
        firstRespondedAt: "2026-07-18T09:00:00.000Z",
        resolutionDueAt: "2026-07-18T14:00:00.000Z",
      }),
    ).toBe("at_risk");
    expect(supportSlaState({ ...base, status: "closed" })).toBe("complete");
  });
});
