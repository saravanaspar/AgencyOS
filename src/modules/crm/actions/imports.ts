"use server";

import { revalidatePath } from "next/cache";

import {
  acknowledgeCrmConnectionNotification,
  checkCrmImportConnectionHealth,
  createCrmImportConnection,
  deleteCrmImportConnection,
  rotateCrmImportConnectionCredentials,
  setCrmImportConnectionStatus,
  syncCrmImportConnection,
  updateCrmImportConnectionSchedule,
} from "@/modules/crm/server/imports";
import {
  crmConnectionCreateSchema,
  crmConnectionCredentialRotationSchema,
  crmConnectionIdSchema,
  crmConnectionNotificationSchema,
  crmConnectionScheduleSchema,
  crmConnectionStatusSchema,
  type CrmImportActionState,
} from "@/modules/crm/schemas/imports";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

const permissions = {
  execute: "crm.import.execute",
  manage: "crm.connection.manage",
} as const;

function values(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function errorState(message: string, fieldErrors?: Record<string, string[]>): CrmImportActionState {
  return { status: "error", message, fieldErrors };
}

function safeActionError(error: unknown, fallback: string): string {
  const databaseError = error && typeof error === "object" ? error : null;
  const detail = (key: string): string | null => {
    if (!databaseError || !(key in databaseError)) return null;
    const value = Reflect.get(databaseError, key);
    return value === undefined || value === null ? null : String(value);
  };
  const code = detail("code");
  if (code) {
    console.warn("[AgencyOS] CRM import action failed.", {
      code,
      table: detail("table_name"),
      column: detail("column_name"),
      routine: detail("routine"),
      fallback,
    });
    return fallback;
  }
  if (!(error instanceof Error)) return fallback;
  return (
    error.message
      .replace(/https?:\/\/\S+/gi, "[provider-url]")
      .replace(/(bearer|token|secret|password)\s+[a-z0-9._~+/=-]+/gi, "$1 [redacted]")
      .slice(0, 500) || fallback
  );
}

function contextFromAuthorization(authorization: Awaited<ReturnType<typeof authorizeCurrentUser>>) {
  if (!authorization.allowed) {
    throw new Error(
      authorization.reason === "insufficient-permission"
        ? "You do not have permission to manage CRM imports."
        : "Your active AgencyOS access could not be verified.",
    );
  }
  return authorization.context;
}

function refresh() {
  revalidatePath("/crm");
  revalidatePath("/dashboard");
}

export async function createCrmConnectionAction(
  _previous: CrmImportActionState,
  formData: FormData,
): Promise<CrmImportActionState> {
  const parsed = crmConnectionCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState(
      "Check the connection fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  try {
    const context = contextFromAuthorization(await authorizeCurrentUser([permissions.manage]));
    const result = await createCrmImportConnection(context, parsed.data);
    refresh();
    return {
      status: "success",
      message: result.oauthStartPath
        ? "Connection saved. Ask the client to approve their OAuth app connection to activate sync."
        : "Connection saved. The client-managed credential is encrypted and is never returned after this response.",
      oneTimeSecret: result.oneTimeSecret,
      connectionId: result.connectionId,
      oauthStartPath: result.oauthStartPath,
    };
  } catch (error) {
    return errorState(safeActionError(error, "The connection could not be saved."));
  }
}

export async function syncCrmConnectionAction(
  _previous: CrmImportActionState,
  formData: FormData,
): Promise<CrmImportActionState> {
  const parsed = crmConnectionIdSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid CRM connection.");

  try {
    const context = contextFromAuthorization(await authorizeCurrentUser([permissions.execute]));
    const result = await syncCrmImportConnection(context, parsed.data.connectionId);
    refresh();
    return {
      status: "success",
      message: `Sync finished: ${result.createdCount} created, ${result.mergedCount} merged, ${result.skippedCount} skipped, ${result.failedCount} failed.`,
    };
  } catch (error) {
    refresh();
    return errorState(safeActionError(error, "The CRM sync failed."));
  }
}

export async function checkCrmConnectionHealthAction(
  _previous: CrmImportActionState,
  formData: FormData,
): Promise<CrmImportActionState> {
  const parsed = crmConnectionIdSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid CRM connection.");

  try {
    const context = contextFromAuthorization(await authorizeCurrentUser([permissions.manage]));
    const message = await checkCrmImportConnectionHealth(context, parsed.data.connectionId);
    refresh();
    return { status: "success", message };
  } catch (error) {
    refresh();
    return errorState(safeActionError(error, "The health check failed."));
  }
}

export async function setCrmConnectionStatusAction(
  _previous: CrmImportActionState,
  formData: FormData,
): Promise<CrmImportActionState> {
  const parsed = crmConnectionStatusSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid connection status.");

  try {
    const context = contextFromAuthorization(await authorizeCurrentUser([permissions.manage]));
    await setCrmImportConnectionStatus(context, parsed.data.connectionId, parsed.data.status);
    refresh();
    return { status: "success", message: `Connection ${parsed.data.status}.` };
  } catch (error) {
    return errorState(safeActionError(error, "The connection status could not be changed."));
  }
}

export async function updateCrmConnectionScheduleAction(
  _previous: CrmImportActionState,
  formData: FormData,
): Promise<CrmImportActionState> {
  const parsed = crmConnectionScheduleSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState(
      "Choose a valid automatic sync schedule.",
      parsed.error.flatten().fieldErrors,
    );
  }

  try {
    const context = contextFromAuthorization(await authorizeCurrentUser([permissions.manage]));
    await updateCrmImportConnectionSchedule(
      context,
      parsed.data.connectionId,
      parsed.data.syncEnabled,
      parsed.data.syncIntervalMinutes,
    );
    refresh();
    return {
      status: "success",
      message: parsed.data.syncEnabled
        ? "Automatic CRM sync schedule updated."
        : "Automatic CRM sync disabled.",
    };
  } catch (error) {
    return errorState(safeActionError(error, "The schedule could not be saved."));
  }
}

export async function rotateCrmConnectionCredentialsAction(
  _previous: CrmImportActionState,
  formData: FormData,
): Promise<CrmImportActionState> {
  const parsed = crmConnectionCredentialRotationSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the credential fields.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = contextFromAuthorization(await authorizeCurrentUser([permissions.manage]));
    const result = await rotateCrmImportConnectionCredentials(
      context,
      parsed.data.connectionId,
      parsed.data,
    );
    refresh();
    return {
      status: "success",
      message: "Connection credentials rotated. Previous credentials are no longer accepted.",
      oneTimeSecret: result.oneTimeSecret,
    };
  } catch (error) {
    return errorState(safeActionError(error, "The credentials could not be rotated."));
  }
}

export async function acknowledgeCrmConnectionNotificationAction(
  _previous: CrmImportActionState,
  formData: FormData,
): Promise<CrmImportActionState> {
  const parsed = crmConnectionNotificationSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid connection alert.");

  try {
    const context = contextFromAuthorization(await authorizeCurrentUser([permissions.manage]));
    await acknowledgeCrmConnectionNotification(context, parsed.data.notificationId);
    refresh();
    return { status: "success", message: "Connection alert acknowledged." };
  } catch (error) {
    return errorState(safeActionError(error, "The alert could not be updated."));
  }
}

export async function deleteCrmConnectionAction(
  _previous: CrmImportActionState,
  formData: FormData,
): Promise<CrmImportActionState> {
  const parsed = crmConnectionIdSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid CRM connection.");

  try {
    const context = contextFromAuthorization(await authorizeCurrentUser([permissions.manage]));
    await deleteCrmImportConnection(context, parsed.data.connectionId);
    refresh();
    return {
      status: "success",
      message: "Connection removed. Existing imported leads were retained.",
    };
  } catch (error) {
    return errorState(safeActionError(error, "The connection could not be removed."));
  }
}
