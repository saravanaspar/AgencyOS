export const notificationCategories = [
  "assignment",
  "mention",
  "approval_requested",
  "approval_decision",
  "task_due",
  "invoice_overdue",
  "leave_status",
  "contract_expiry",
  "licence_expiry",
  "asset_return",
  "support_reply",
  "security_alert",
  "integration_failure",
  "automation",
] as const;

export type NotificationCategory = (typeof notificationCategories)[number];
export type NotificationSeverity = "info" | "warning" | "error";
export type NotificationStatusFilter = "all" | "unread" | "read";
export type NotificationDigestPreference = "none" | "daily" | "weekly";

export const notificationCategoryLabels: Record<NotificationCategory, string> = {
  assignment: "Assignments",
  mention: "Mentions",
  approval_requested: "Approval requests",
  approval_decision: "Approval decisions",
  task_due: "Task due dates",
  invoice_overdue: "Overdue invoices",
  leave_status: "Leave status",
  contract_expiry: "Contract expiry",
  licence_expiry: "Licence expiry",
  asset_return: "Asset returns",
  support_reply: "Support replies",
  security_alert: "Security alerts",
  integration_failure: "Integration failures",
  automation: "Automation",
};

export interface NotificationPreferences {
  categories: Record<NotificationCategory, boolean>;
  emailEnabled: boolean;
  browserPushEnabled: boolean;
  digest: NotificationDigestPreference;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
}

export const defaultNotificationPreferences: NotificationPreferences = {
  categories: Object.fromEntries(
    notificationCategories.map((category) => [category, true]),
  ) as Record<NotificationCategory, boolean>,
  emailEnabled: false,
  browserPushEnabled: false,
  digest: "none",
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
  },
};

export interface NotificationDeliverySummary {
  channel: "in_app" | "email" | "browser_push";
  status: "pending" | "delivered" | "failed" | "suppressed";
  attemptCount: number;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  lastErrorCode: string | null;
}

export interface NotificationListItem {
  id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  deepLink: string | null;
  sourceModule: string;
  sourceEntityType: string | null;
  occurrenceCount: number;
  lastOccurredAt: string;
  readAt: string | null;
  deliveries: NotificationDeliverySummary[];
}

export interface NotificationDeliveryPublicConfiguration {
  emailConfigured: boolean;
  browserPushConfigured: boolean;
  browserPushPublicKey: string | null;
  hasActivePushSubscription: boolean;
}

export interface NotificationCenterData {
  items: NotificationListItem[];
  preferences: NotificationPreferences;
  deliveryConfiguration: NotificationDeliveryPublicConfiguration;
  filters: {
    status: NotificationStatusFilter;
    category: NotificationCategory | "";
    page: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  summary: {
    unreadCount: number;
    totalCount: number;
    occurredToday: number;
  };
}

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return (
    typeof value === "string" && notificationCategories.includes(value as NotificationCategory)
  );
}

export function safeNotificationDeepLink(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//")) return null;
  return normalized.slice(0, 500);
}

function isTimeValue(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const categoryRecord =
    record.categories && typeof record.categories === "object" && !Array.isArray(record.categories)
      ? (record.categories as Record<string, unknown>)
      : {};
  const quietRecord =
    record.quietHours && typeof record.quietHours === "object" && !Array.isArray(record.quietHours)
      ? (record.quietHours as Record<string, unknown>)
      : {};
  const digest = record.digest;

  return {
    categories: Object.fromEntries(
      notificationCategories.map((category) => [
        category,
        typeof categoryRecord[category] === "boolean"
          ? categoryRecord[category]
          : defaultNotificationPreferences.categories[category],
      ]),
    ) as Record<NotificationCategory, boolean>,
    emailEnabled:
      typeof record.emailEnabled === "boolean"
        ? record.emailEnabled
        : defaultNotificationPreferences.emailEnabled,
    browserPushEnabled:
      typeof record.browserPushEnabled === "boolean"
        ? record.browserPushEnabled
        : defaultNotificationPreferences.browserPushEnabled,
    digest: digest === "daily" || digest === "weekly" || digest === "none" ? digest : "none",
    quietHours: {
      enabled:
        typeof quietRecord.enabled === "boolean"
          ? quietRecord.enabled
          : defaultNotificationPreferences.quietHours.enabled,
      start: isTimeValue(quietRecord.start)
        ? quietRecord.start
        : defaultNotificationPreferences.quietHours.start,
      end: isTimeValue(quietRecord.end)
        ? quietRecord.end
        : defaultNotificationPreferences.quietHours.end,
    },
  };
}
