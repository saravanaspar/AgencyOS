import "server-only";

import { randomUUID } from "node:crypto";

import { getDatabaseClient } from "@/integrations/postgres/database";
import type { AiProvider } from "@/modules/ai/ai";
import type { AgencyOsMcpToolDescriptor } from "@/modules/mcp/tool-registry";
import {
  getCurrentPermissionContext,
  type CurrentPermissionContext,
} from "@/modules/permissions/server/effective-permissions";

export interface OrganizationAiGovernancePolicy {
  enabled: boolean;
  externalDataEgressEnabled: boolean;
  allowedProviders: ReadonlySet<AiProvider>;
  allowedModules: ReadonlySet<string>;
  allowLowRiskMutations: boolean;
}

export interface CurrentAiGovernance {
  context: CurrentPermissionContext;
  policy: OrganizationAiGovernancePolicy;
}

interface AiPolicyRow {
  enabled: boolean;
  external_data_egress_enabled: boolean;
  allowed_providers: string[];
  allowed_modules: string[];
  allow_low_risk_mutations: boolean;
}

function moduleForTool(toolName: string): string | null {
  const match = /^agencyos\.([a-z][a-z0-9_]*)\./.exec(toolName);
  return match?.[1] ?? null;
}

export async function requireCurrentAiGovernance(
  provider: AiProvider,
): Promise<CurrentAiGovernance> {
  const access = await getCurrentPermissionContext();
  if (!access.allowed) throw new Error(`AgencyOS access denied: ${access.reason}.`);

  const database = getDatabaseClient();
  const [row] = await database<AiPolicyRow[]>`
    select enabled, external_data_egress_enabled, allowed_providers, allowed_modules,
           allow_low_risk_mutations
    from public.organization_ai_policies
    where organization_id = ${access.context.membership.organizationId}::uuid
  `;
  if (!row || !row.enabled)
    throw new Error("AI is disabled by this organization's governance policy.");
  if (!row.external_data_egress_enabled) {
    throw new Error(
      "External AI data egress is disabled by this organization's governance policy.",
    );
  }

  const allowedProviders = new Set(
    row.allowed_providers.filter(
      (value): value is AiProvider => value === "gemini" || value === "deepseek",
    ),
  );
  if (!allowedProviders.has(provider)) {
    throw new Error(`The ${provider} provider is not allowed by this organization's AI policy.`);
  }

  return {
    context: access.context,
    policy: {
      enabled: row.enabled,
      externalDataEgressEnabled: row.external_data_egress_enabled,
      allowedProviders,
      allowedModules: new Set(row.allowed_modules),
      allowLowRiskMutations: row.allow_low_risk_mutations,
    },
  };
}

export function filterToolsForAiPolicy(
  tools: AgencyOsMcpToolDescriptor[],
  policy: OrganizationAiGovernancePolicy,
): AgencyOsMcpToolDescriptor[] {
  return tools.filter((tool) => {
    const moduleName = moduleForTool(tool.name);
    if (!moduleName || !policy.allowedModules.has(moduleName)) return false;
    if (tool.annotations?.readOnlyHint) return true;
    return policy.allowLowRiskMutations;
  });
}

export async function recordAiProviderEvent(input: {
  context: CurrentPermissionContext;
  provider: AiProvider;
  model: string;
  status: "started" | "succeeded" | "failed";
  messageCount: number;
  availableToolCount: number;
  durationMs?: number | null;
  errorCode?: string | null;
}): Promise<void> {
  const database = getDatabaseClient();
  await database`
    insert into public.automation_ai_provider_events (
      id, organization_id, actor_membership_id, provider, model, status,
      message_count, available_tool_count, duration_ms, error_code
    ) values (
      ${randomUUID()}::uuid,
      ${input.context.membership.organizationId}::uuid,
      ${input.context.membership.id}::uuid,
      ${input.provider},
      ${input.model.slice(0, 120)},
      ${input.status},
      ${input.messageCount},
      ${input.availableToolCount},
      ${input.durationMs ?? null},
      ${input.errorCode?.slice(0, 120) ?? null}
    )
  `;
}
