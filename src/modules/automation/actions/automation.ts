"use server";

import { revalidatePath } from "next/cache";

import {
  createAutomationDefinitionSchema,
  createVaultwardenLinkSchema,
  revokeVaultwardenLinkSchema,
  retryAutomationDispatchSchema,
  setAutomationEnabledSchema,
  type AutomationActionState,
} from "@/modules/automation/schemas/automation";
import {
  automationPermissionKeys,
  createAutomationDefinition,
  createVaultwardenLink,
  revokeVaultwardenLink,
  retryAutomationDispatch,
  setAutomationEnabled,
} from "@/modules/automation/server/automation";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

function fields(error: { flatten: () => { fieldErrors: Record<string, string[]> } }) {
  return error.flatten().fieldErrors;
}

function safeMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return /not found|already|invalid|access denied|must not include sensitive|exceeds|could not be created/i.test(
    message,
  )
    ? message
    : fallback;
}

function refreshAutomation() {
  revalidatePath("/automation");
  revalidatePath("/settings/audit");
}

export async function createAutomationDefinitionAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  let conditions: unknown = {};
  try {
    conditions = JSON.parse(String(formData.get("conditions") ?? "{}"));
  } catch {
    return { status: "error", message: "Conditions must be a valid JSON object." };
  }
  const parsed = createAutomationDefinitionSchema.safeParse({
    name: formData.get("name"),
    triggerKey: formData.get("triggerKey"),
    handlerKey: formData.get("handlerKey"),
    allowedModules: formData.getAll("allowedModules").map(String),
    conditions,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the automation definition values.",
      fieldErrors: fields(parsed.error),
    };
  }
  const authorization = await authorizeCurrentUser([automationPermissionKeys.manageDefinitions]);
  if (!authorization.allowed) return { status: "error", message: "Automation access denied." };
  try {
    await createAutomationDefinition(authorization.context, parsed.data);
    refreshAutomation();
    return { status: "success", message: "Automation definition created." };
  } catch (error) {
    return {
      status: "error",
      message: safeMessage(error, "Automation definition could not be created."),
    };
  }
}

export async function setAutomationEnabledAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const parsed = setAutomationEnabledSchema.safeParse({
    automationId: formData.get("automationId"),
    enabled: formData.get("enabled") === "true",
  });
  if (!parsed.success) return { status: "error", message: "Automation selection is invalid." };
  const authorization = await authorizeCurrentUser([automationPermissionKeys.manageDefinitions]);
  if (!authorization.allowed) return { status: "error", message: "Automation access denied." };
  try {
    await setAutomationEnabled(
      authorization.context,
      parsed.data.automationId,
      parsed.data.enabled,
    );
    refreshAutomation();
    return {
      status: "success",
      message: parsed.data.enabled ? "Automation enabled." : "Automation disabled.",
    };
  } catch (error) {
    return { status: "error", message: safeMessage(error, "Automation could not be updated.") };
  }
}

export async function createVaultwardenLinkAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const target = String(formData.get("entityTarget") ?? "");
  const separator = target.indexOf(":");
  const entityType = separator > 0 ? target.slice(0, separator) : formData.get("entityType");
  const entityId = separator > 0 ? target.slice(separator + 1) : formData.get("entityId");
  const parsed = createVaultwardenLinkSchema.safeParse({
    entityType,
    entityId,
    entityLabel: formData.get("entityLabel") || "Vendor reference",
    itemReference: formData.get("itemReference"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the Vaultwarden item link values.",
      fieldErrors: fields(parsed.error),
    };
  }
  const authorization = await authorizeCurrentUser([
    automationPermissionKeys.manageVaultwardenLinks,
  ]);
  if (!authorization.allowed)
    return { status: "error", message: "Vaultwarden link access denied." };
  try {
    await createVaultwardenLink(authorization.context, parsed.data);
    refreshAutomation();
    return { status: "success", message: "Vaultwarden item reference linked." };
  } catch (error) {
    return {
      status: "error",
      message: safeMessage(error, "Vaultwarden item link could not be created."),
    };
  }
}

export async function revokeVaultwardenLinkAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const parsed = revokeVaultwardenLinkSchema.safeParse({ linkId: formData.get("linkId") });
  if (!parsed.success) return { status: "error", message: "Vaultwarden item link is invalid." };
  const authorization = await authorizeCurrentUser([
    automationPermissionKeys.manageVaultwardenLinks,
  ]);
  if (!authorization.allowed)
    return { status: "error", message: "Vaultwarden link access denied." };
  try {
    await revokeVaultwardenLink(authorization.context, parsed.data.linkId);
    refreshAutomation();
    return { status: "success", message: "Vaultwarden item reference removed." };
  } catch (error) {
    return {
      status: "error",
      message: safeMessage(error, "Vaultwarden item link could not be removed."),
    };
  }
}

export async function retryAutomationDispatchAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const parsed = retryAutomationDispatchSchema.safeParse({
    dispatchId: formData.get("dispatchId"),
  });
  if (!parsed.success) return { status: "error", message: "Automation dispatch is invalid." };
  const authorization = await authorizeCurrentUser([automationPermissionKeys.retryExecutions]);
  if (!authorization.allowed)
    return { status: "error", message: "Automation retry access denied." };
  try {
    await retryAutomationDispatch(authorization.context, parsed.data.dispatchId);
    refreshAutomation();
    return { status: "success", message: "Automation dispatch queued for retry." };
  } catch (error) {
    return {
      status: "error",
      message: safeMessage(error, "Automation dispatch could not be retried."),
    };
  }
}
