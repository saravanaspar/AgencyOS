import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { decryptSecretObjectWithEnvironmentKey } from "@/lib/security/secret-envelope";
import {
  defaultAiModels,
  integrationSettingsPermissionKeys,
  type IntegrationSettingsData,
  type OrganizationIntegrationConfiguration,
} from "@/modules/integrations/integration-settings";
import {
  authorizeCurrentUser,
  type AuthorizationFailureReason,
} from "@/modules/permissions/server/authorization";

const SETTINGS_KEY_ENV = "CRM_CONNECTOR_ENCRYPTION_KEY";
const SETTINGS_KEY_PURPOSE = "organization integration settings";

interface SettingsRow {
  configuration: unknown;
  encrypted_secrets: string | null;
  updated_at: Date;
}

type SettingsRecord = Record<string, unknown>;

function isUndefinedTable(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && Reflect.get(error, "code") === "42P01");
}

function record(value: unknown): SettingsRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SettingsRecord)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function modelList(value: unknown, fallback: readonly string[]): string[] {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const models = source
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^[a-zA-Z0-9._-]{2,100}$/.test(item));
  return models.length ? [...new Set(models)].slice(0, 12) : [...fallback];
}

function defaultConfiguration(): OrganizationIntegrationConfiguration {
  return {
    managedInApplication: false,
    ai: {
      geminiApiKey: null,
      geminiModels: [...defaultAiModels.gemini],
      deepseekApiKey: null,
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModels: [...defaultAiModels.deepseek],
    },
    notifications: {
      resendApiKey: text(process.env.RESEND_API_KEY),
      emailFrom: text(process.env.NOTIFICATION_EMAIL_FROM),
      vapidPublicKey: null,
      vapidPrivateKey: null,
      vapidSubject: null,
    },
    vaultwardenUrl: null,
  };
}

function storedConfiguration(row: SettingsRow): OrganizationIntegrationConfiguration {
  const configuration = record(row.configuration);
  if (configuration.managed !== true) return defaultConfiguration();
  const ai = record(configuration.ai);
  const notifications = record(configuration.notifications);
  const secrets = row.encrypted_secrets
    ? decryptSecretObjectWithEnvironmentKey(
        row.encrypted_secrets,
        SETTINGS_KEY_ENV,
        SETTINGS_KEY_PURPOSE,
      )
    : {};
  return {
    managedInApplication: true,
    ai: {
      geminiApiKey: text(secrets.geminiApiKey),
      geminiModels: modelList(ai.geminiModels, defaultAiModels.gemini),
      deepseekApiKey: text(secrets.deepseekApiKey),
      deepseekBaseUrl: text(ai.deepseekBaseUrl) ?? "https://api.deepseek.com",
      deepseekModels: modelList(ai.deepseekModels, defaultAiModels.deepseek),
    },
    notifications: {
      resendApiKey: text(process.env.RESEND_API_KEY),
      emailFrom: text(process.env.NOTIFICATION_EMAIL_FROM),
      vapidPublicKey: text(notifications.vapidPublicKey),
      vapidPrivateKey: text(secrets.vapidPrivateKey),
      vapidSubject: text(notifications.vapidSubject),
    },
    vaultwardenUrl: text(configuration.vaultwardenUrl),
  };
}

export async function getOrganizationIntegrationConfiguration(
  organizationId?: string | null,
): Promise<OrganizationIntegrationConfiguration> {
  if (!organizationId) return defaultConfiguration();
  const database = getDatabaseClient();
  try {
    const rows = await database<SettingsRow[]>`
      select configuration, encrypted_secrets, updated_at
      from public.organization_integration_settings
      where organization_id = ${organizationId}::uuid
      limit 1
    `;
    return rows[0] ? storedConfiguration(rows[0]) : defaultConfiguration();
  } catch (error) {
    if (isUndefinedTable(error)) return defaultConfiguration();
    throw error;
  }
}

export type IntegrationSettingsResult =
  | { allowed: true; data: IntegrationSettingsData }
  | { allowed: false; reason: AuthorizationFailureReason };

export async function getIntegrationSettingsData(): Promise<IntegrationSettingsResult> {
  const authorization = await authorizeCurrentUser([integrationSettingsPermissionKeys.view]);
  if (!authorization.allowed) return authorization;
  const organizationId = authorization.context.membership.organizationId;
  const database = getDatabaseClient();
  let rows: SettingsRow[];
  try {
    rows = await database<SettingsRow[]>`
      select configuration, encrypted_secrets, updated_at
      from public.organization_integration_settings
      where organization_id = ${organizationId}::uuid
      limit 1
    `;
  } catch (error) {
    if (!isUndefinedTable(error)) throw error;
    rows = [];
  }
  const configuration = rows[0] ? storedConfiguration(rows[0]) : defaultConfiguration();
  return {
    allowed: true,
    data: {
      managedInApplication: configuration.managedInApplication,
      geminiConfigured: Boolean(configuration.ai.geminiApiKey),
      geminiModels: configuration.ai.geminiModels.join(", "),
      deepseekConfigured: Boolean(configuration.ai.deepseekApiKey),
      deepseekBaseUrl: configuration.ai.deepseekBaseUrl,
      deepseekModels: configuration.ai.deepseekModels.join(", "),
      browserPushConfigured: Boolean(
        configuration.notifications.vapidPublicKey &&
        configuration.notifications.vapidPrivateKey &&
        configuration.notifications.vapidSubject,
      ),
      vapidPublicKey: configuration.notifications.vapidPublicKey ?? "",
      vapidSubject: configuration.notifications.vapidSubject ?? "",
      vaultwardenUrl: configuration.vaultwardenUrl ?? "",
      canManage: authorization.context.permissions.has(integrationSettingsPermissionKeys.manage),
      updatedAt: rows[0]?.updated_at.toISOString() ?? null,
    },
  };
}
