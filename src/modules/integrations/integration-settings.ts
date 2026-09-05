export const integrationSettingsPermissionKeys = {
  view: "settings.integration.view",
  manage: "settings.integration.manage_settings",
} as const;

export const defaultAiModels = {
  gemini: ["gemini-3.5-flash", "gemini-3.1-pro-preview"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
} as const;

export interface OrganizationIntegrationConfiguration {
  managedInApplication: boolean;
  ai: {
    geminiApiKey: string | null;
    geminiModels: string[];
    deepseekApiKey: string | null;
    deepseekBaseUrl: string;
    deepseekModels: string[];
  };
  notifications: {
    resendApiKey: string | null;
    emailFrom: string | null;
    vapidPublicKey: string | null;
    vapidPrivateKey: string | null;
    vapidSubject: string | null;
  };
  vaultwardenUrl: string | null;
}

export interface IntegrationSettingsData {
  managedInApplication: boolean;
  geminiConfigured: boolean;
  geminiModels: string;
  deepseekConfigured: boolean;
  deepseekBaseUrl: string;
  deepseekModels: string;
  browserPushConfigured: boolean;
  vapidPublicKey: string;
  vapidSubject: string;
  vaultwardenUrl: string;
  canManage: boolean;
  updatedAt: string | null;
}

export interface IntegrationSettingsActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}
