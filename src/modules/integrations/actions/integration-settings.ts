"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  decryptSecretObjectWithEnvironmentKey,
  encryptSecretObjectWithEnvironmentKey,
} from "@/lib/security/secret-envelope";
import { toJsonValue } from "@/lib/server/json-value";
import {
  integrationSettingsPermissionKeys,
  type IntegrationSettingsActionState,
} from "@/modules/integrations/integration-settings";
import { integrationSettingsSchema } from "@/modules/integrations/schemas/integration-settings";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

const SETTINGS_KEY_ENV = "CRM_CONNECTOR_ENCRYPTION_KEY";
const SETTINGS_KEY_PURPOSE = "organization integration settings";

function values(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function models(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function safeAuditSnapshot(
  configuration: Record<string, unknown>,
  secrets: Record<string, string>,
) {
  return {
    configuration,
    configuredSecrets: Object.keys(secrets).sort(),
  };
}

export async function updateIntegrationSettingsAction(
  _previousState: IntegrationSettingsActionState,
  formData: FormData,
): Promise<IntegrationSettingsActionState> {
  const parsed = integrationSettingsSchema.safeParse(values(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the integration fields and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const authorization = await authorizeCurrentUser([
    integrationSettingsPermissionKeys.view,
    integrationSettingsPermissionKeys.manage,
  ]);
  if (!authorization.allowed) {
    return {
      status: "error",
      message:
        authorization.reason === "insufficient-permission"
          ? "You do not have permission to manage integration settings."
          : "Your session or organization access is no longer active.",
    };
  }

  const context = authorization.context;
  const database = getDatabaseClient();
  try {
    await database.begin(async (sql) => {
      const rows = await sql<Array<{ configuration: unknown; encrypted_secrets: string | null }>>`
        select configuration, encrypted_secrets
        from public.organization_integration_settings
        where organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const previousRow = rows[0];
      const previousConfiguration =
        previousRow?.configuration &&
        typeof previousRow.configuration === "object" &&
        !Array.isArray(previousRow.configuration)
          ? (previousRow.configuration as Record<string, unknown>)
          : {};
      const previousSecrets = previousRow?.encrypted_secrets
        ? decryptSecretObjectWithEnvironmentKey(
            previousRow.encrypted_secrets,
            SETTINGS_KEY_ENV,
            SETTINGS_KEY_PURPOSE,
          )
        : {};
      const secrets = { ...previousSecrets };
      const input = parsed.data;
      if (input.clearGeminiApiKey) delete secrets.geminiApiKey;
      else if (input.geminiApiKey) secrets.geminiApiKey = input.geminiApiKey;
      if (input.clearDeepseekApiKey) delete secrets.deepseekApiKey;
      else if (input.deepseekApiKey) secrets.deepseekApiKey = input.deepseekApiKey;
      if (input.clearVapidKeys) delete secrets.vapidPrivateKey;
      else if (input.vapidPrivateKey) secrets.vapidPrivateKey = input.vapidPrivateKey;

      const configuration = {
        managed: true,
        ai: {
          geminiModels: models(input.geminiModels),
          deepseekBaseUrl: input.deepseekBaseUrl.replace(/\/$/, ""),
          deepseekModels: models(input.deepseekModels),
        },
        notifications: {
          vapidPublicKey: input.clearVapidKeys ? null : input.vapidPublicKey || null,
          vapidSubject: input.clearVapidKeys ? null : input.vapidSubject || null,
        },
        vaultwardenUrl: input.vaultwardenUrl.replace(/\/$/, "") || null,
      };
      const encryptedSecrets = Object.keys(secrets).length
        ? encryptSecretObjectWithEnvironmentKey(secrets, SETTINGS_KEY_ENV, SETTINGS_KEY_PURPOSE)
        : null;
      await sql`
        insert into public.organization_integration_settings (
          organization_id, configuration, encrypted_secrets, updated_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid,
          ${sql.json(toJsonValue(configuration))},
          ${encryptedSecrets},
          ${context.membership.id}::uuid
        )
        on conflict (organization_id) do update set
          configuration = excluded.configuration,
          encrypted_secrets = excluded.encrypted_secrets,
          updated_by_membership_id = excluded.updated_by_membership_id
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id, source,
          before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid,
          ${context.user.id}::uuid,
          'settings.integrations_updated',
          'organization_integration_settings',
          ${context.membership.organizationId},
          'web',
          ${sql.json(toJsonValue(safeAuditSnapshot(previousConfiguration, previousSecrets)))},
          ${sql.json(toJsonValue(safeAuditSnapshot(configuration, secrets)))},
          ${["configuration", "configured_secrets"]}::text[],
          ${sql.json(toJsonValue({ actorMembershipId: context.membership.id }))}
        )
      `;
    });
    revalidatePath("/settings");
    revalidatePath("/settings/integrations");
    revalidatePath("/ai");
    revalidatePath("/notifications");
    return { status: "success", message: "Integration settings saved." };
  } catch (error) {
    console.warn("[AgencyOS] Integration settings update failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      status: "error",
      message: "Integration settings could not be saved. Check the encryption key and try again.",
    };
  }
}
