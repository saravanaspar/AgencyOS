"use server";

import { revalidatePath } from "next/cache";

import {
  notificationIdSchema,
  notificationPreferencesSchema,
  type NotificationActionState,
} from "@/modules/notifications/schemas/notifications";
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationPermissionKeys,
  notificationPreferencesForForm,
  updateNotificationPreferences,
} from "@/modules/notifications/server/notifications";
import {
  authorizeCurrentUser,
  type AuthorizationFailureReason,
} from "@/modules/permissions/server/authorization";

function booleanFormValue(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

function safeActionError(): NotificationActionState {
  return { status: "error", message: "The notification update could not be completed." };
}

function authorizationError(reason: AuthorizationFailureReason): NotificationActionState {
  if (reason === "insufficient-permission") {
    return {
      status: "error",
      message: "Your role does not allow notification preference changes.",
    };
  }
  if (reason === "access-check-failed") {
    return {
      status: "error",
      message: "Notification permissions could not be checked. Please retry.",
    };
  }
  return safeActionError();
}

function notificationPreferenceFailure(error: unknown): NotificationActionState {
  const databaseError = error && typeof error === "object" ? error : null;
  const detail = (key: string): string | null => {
    if (!databaseError || !(key in databaseError)) return null;
    const value = Reflect.get(databaseError, key);
    return value === undefined || value === null ? null : String(value);
  };
  const code = detail("code");

  console.warn("[AgencyOS] Notification preference update failed.", {
    code,
    table: detail("table_name"),
    column: detail("column_name"),
    constraint: detail("constraint_name"),
    routine: detail("routine"),
  });

  if (code === "42P01" || code === "42703" || code === "42704") {
    return {
      status: "error",
      message:
        "The notification database contract is out of date. Apply pending migrations, then retry.",
    };
  }
  if (code === "42501") {
    return {
      status: "error",
      message: "The database role cannot update notification preferences.",
    };
  }
  if (code === "23503") {
    return {
      status: "error",
      message: "Your membership changed. Refresh the page and retry.",
    };
  }
  if (code === "23514") {
    return {
      status: "error",
      message:
        "The notification preference payload was rejected. Apply the latest source update and retry.",
    };
  }
  return safeActionError();
}

export async function markNotificationReadAction(
  _previous: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const parsed = notificationIdSchema.safeParse({
    notificationId: formData.get("notificationId"),
  });
  if (!parsed.success) return safeActionError();

  const authorization = await authorizeCurrentUser([notificationPermissionKeys.update]);
  if (!authorization.allowed) return safeActionError();

  try {
    await markNotificationRead(authorization.context, parsed.data.notificationId);
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
    return { status: "success", message: "Notification marked as read." };
  } catch {
    return safeActionError();
  }
}

export async function markAllNotificationsReadAction(
  previousState: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  void previousState;
  void formData;
  const authorization = await authorizeCurrentUser([notificationPermissionKeys.update]);
  if (!authorization.allowed) return safeActionError();

  try {
    const count = await markAllNotificationsRead(authorization.context);
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
    return {
      status: "success",
      message:
        count === 0 ? "No unread notifications remained." : `${count} notifications marked read.`,
    };
  } catch {
    return safeActionError();
  }
}

export async function updateNotificationPreferencesAction(
  _previous: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const parsed = notificationPreferencesSchema.safeParse({
    enabledCategories: formData.getAll("enabledCategories"),
    emailEnabled: booleanFormValue(formData.get("emailEnabled")),
    browserPushEnabled: booleanFormValue(formData.get("browserPushEnabled")),
    digest: formData.get("digest"),
    quietHoursEnabled: booleanFormValue(formData.get("quietHoursEnabled")),
    quietHoursStart: formData.get("quietHoursStart"),
    quietHoursEnd: formData.get("quietHoursEnd"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Review the notification preference values." };
  }

  const authorization = await authorizeCurrentUser([notificationPermissionKeys.managePreferences]);
  if (!authorization.allowed) return authorizationError(authorization.reason);

  try {
    await updateNotificationPreferences(
      authorization.context,
      notificationPreferencesForForm(parsed.data),
    );
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
    return { status: "success", message: "Notification preferences saved." };
  } catch (error) {
    return notificationPreferenceFailure(error);
  }
}
