import { legalPermissionKeys } from "@/modules/legal/legal";

export const legalAccessReviewPermissionKeys = {
  view: legalPermissionKeys.accessReviewView,
  manage: legalPermissionKeys.accessReviewManage,
} as const;

export const legalAccessReviewDecisions = ["retain", "revoke"] as const;
export type LegalAccessReviewDecision = (typeof legalAccessReviewDecisions)[number];

export const legalAccessReviewCadenceDays = 90;
export const legalAccessReviewWindowDays = 14;
export const legalAccessReviewWorkerCampaignLimit = 10;
export const legalAccessReviewNotificationRecipientLimit = 20;

export type LegalAccessReviewSource =
  | {
      kind: "role";
      roleId: string;
      roleKey: string;
      roleName: string;
      scope: string;
    }
  | {
      kind: "override";
      effect: "allow";
      scope: string | null;
      reason: string;
      expiresAt: string | null;
    };

export interface LegalAccessReviewPermissionSnapshot {
  permissionId: string;
  key: string;
  effectiveScope: string;
  sources: LegalAccessReviewSource[];
}

export interface LegalAccessReviewSnapshot {
  capturedAt: string;
  permissions: LegalAccessReviewPermissionSnapshot[];
}

function utcDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid access-review date.");
  return date;
}

export function legalAccessReviewNextScheduledFor(
  lastScheduledFor: string | null,
  today: Date | string = new Date(),
): string {
  const date = lastScheduledFor ? utcDate(lastScheduledFor) : utcDate(today);
  if (lastScheduledFor) date.setUTCDate(date.getUTCDate() + legalAccessReviewCadenceDays);
  return date.toISOString().slice(0, 10);
}

export function legalAccessReviewDueAt(openedAt: Date | string): Date {
  const opened = openedAt instanceof Date ? new Date(openedAt.getTime()) : new Date(openedAt);
  if (!Number.isFinite(opened.getTime())) throw new Error("Invalid access-review opening time.");
  opened.setUTCDate(opened.getUTCDate() + legalAccessReviewWindowDays);
  return opened;
}

export function legalAccessReviewIsOverdue(
  dueAt: Date | string,
  completedAt: Date | string | null,
  now = Date.now(),
): boolean {
  return completedAt === null && new Date(dueAt).getTime() < now;
}
