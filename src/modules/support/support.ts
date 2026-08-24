export const supportPermissionKeys = {
  workspace: "support.workspace.view",
  view: "support.ticket.view",
  create: "support.ticket.create",
  update: "support.ticket.update",
  assign: "support.ticket.assign",
  reply: "support.ticket.reply",
  internalNote: "support.ticket.internal_note",
  manageWatchers: "support.ticket.manage_watchers",
  resolve: "support.ticket.resolve",
  close: "support.ticket.close",
  reopen: "support.ticket.reopen",
  manageCategories: "support.category.manage",
  manageRoutingRules: "support.routing_rule.manage",
} as const;

export const supportTicketPriorities = ["low", "normal", "high", "urgent"] as const;
export const supportTicketStatuses = [
  "new",
  "open",
  "pending_customer",
  "pending_internal",
  "resolved",
  "closed",
] as const;
export const supportMessageTypes = ["public_reply", "internal_note"] as const;
export const supportTriageSources = ["manual", "rule", "fallback"] as const;

export type SupportTicketPriority = (typeof supportTicketPriorities)[number];
export type SupportTicketStatus = (typeof supportTicketStatuses)[number];
export type SupportMessageType = (typeof supportMessageTypes)[number];
export type SupportTriageSource = (typeof supportTriageSources)[number];

export const supportTicketPriorityLabels: Record<SupportTicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const supportTicketStatusLabels: Record<SupportTicketStatus, string> = {
  new: "New",
  open: "Open",
  pending_customer: "Waiting for customer",
  pending_internal: "Waiting internally",
  resolved: "Resolved",
  closed: "Closed",
};

export function supportTicketKey(ticketNumber: number): string {
  return `SUP-${String(ticketNumber).padStart(6, "0")}`;
}

export function supportSlaState(input: {
  status: SupportTicketStatus;
  firstRespondedAt: string | null;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  now?: Date;
}):
  | "paused"
  | "first_response_breached"
  | "resolution_breached"
  | "at_risk"
  | "healthy"
  | "complete" {
  if (input.status === "resolved" || input.status === "closed") return "complete";
  if (input.status === "pending_customer") return "paused";
  const now = input.now ?? new Date();
  if (!input.firstRespondedAt && new Date(input.firstResponseDueAt) < now) {
    return "first_response_breached";
  }
  const resolutionDue = new Date(input.resolutionDueAt);
  if (resolutionDue < now) return "resolution_breached";
  if (resolutionDue.getTime() - now.getTime() <= 4 * 60 * 60 * 1000) return "at_risk";
  return "healthy";
}

export function supportRoutingRuleMatches(
  subject: string,
  description: string,
  keywords: readonly string[],
): boolean {
  const searchable = `${subject}\n${description}`.toLocaleLowerCase();
  return keywords.some((keyword) => {
    const normalized = keyword.trim().toLocaleLowerCase();
    return normalized.length >= 2 && searchable.includes(normalized);
  });
}
