export type CollectionStage =
  | "pre_due"
  | "due_today"
  | "overdue_7"
  | "overdue_14"
  | "overdue_30"
  | "overdue_45"
  | "overdue_60"
  | "overdue_90"
  | "open";

export interface CollectionPolicy {
  preDueDays: number;
  overdueStageDays: number[];
  founderEscalationDays: number;
  reminderChannels: Array<"email" | "in_app">;
  reminderSubjectTemplate: string;
  reminderBodyTemplate: string;
}

export interface CollectionCaseSummary {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  companyName: string;
  amountMinor: number;
  currency: string;
  dueDate: string | null;
  stage: CollectionStage;
  status: "open" | "promise_to_pay" | "disputed" | "resolved" | "suppressed";
  promiseToPayOn: string | null;
  disputeSuppressed: boolean;
  nextActionAt: string | null;
  ownerMembershipId: string | null;
  lastReminderAt: string | null;
  lastDeliveryStatus: "delivered" | "failed" | null;
  lastDeliveryAt: string | null;
  lastDeliveryError: string | null;
  retryPending: boolean;
}

export interface CollectionsData {
  policy: CollectionPolicy;
  cases: CollectionCaseSummary[];
}
